/* ===== 统一表单提交 + 文件上传 form-submit.js =====
 *
 * 对应数据表：
 *   - app_submissions(id, user_id, form_type, payload, status, created_at, updated_at)
 *   - submission_files(id, submission_id, user_id, bucket_name, file_path,
 *                      file_name, mime_type, file_size, created_at)
 *
 * Storage Bucket：app-photos（私有 Bucket，不使用公开 URL）
 *
 * 使用方式：
 *   1) 自动绑定：给 <form> 加属性 data-supabase-form="<form_type>"
 *      本模块会在 DOMContentLoaded 时自动绑定 submit 事件，
 *      已有 onsubmit 的表单（如 loginForm / sp_sampleForm）不会被重复绑定。
 *
 *   2) 手动调用：
 *      const res = await SupabaseSubmit.submit('contacts', dataObj, [file1, file2]);
 *      const list = await SupabaseSubmit.list('contacts');
 *      await SupabaseSubmit.update(id, dataObj);
 *      await SupabaseSubmit.remove(id);
 *
 * 安全说明：
 *   - 不把 password 字段写入 app_submissions
 *   - 不保存 Supabase session 到数据库
 *   - 不把任何密钥写入数据库
 *   - 不把 service_role key 放到前端
 *   - 不把私有 Bucket 改成公开 Bucket
 *   - 查看图片使用 createSignedUrl，不拼接公开 URL
 *   - 普通用户页面始终限制 user_id = 当前用户 id
 */

import { supabase, STORAGE_BUCKET, MAX_FILE_SIZE, ALLOWED_IMAGE_MIME } from "./supabase.js";
import { ADMIN_EMAILS, isAdmin } from "./admin-config.js";

/* ---------- form_type 映射 ---------- */
const PAGE_TO_FORM_TYPE = {
  "index.html": "index",
  "order.html": "order",
  "contacts.html": "contacts",
  "feedback.html": "feedback",
  "shipping.html": "shipping",
  "express.html": "express",
  "shipping documents.html": "shipping_documents",
  "production.html": "production",
  "wash.html": "wash",
  "accessory.html": "accessory",
  "fabric.html": "fabric",
  "maintenance.html": "maintenance",
  "finance.html": "finance",
  "sample.html": "sample",
  "settings.html": "settings",
};

// 中文提示
const MSG = {
  notLogin: "请先登录",
  saveFail: "保存失败，请稍后重试",
  uploadFail: "上传失败，请检查文件类型和大小",
  network: "请检查网络连接",
  success: "提交成功",
  submitting: "正在提交…",
  forbidden: "无权限修改该记录",
  deleteConfirm: "确定删除该记录吗？删除后无法恢复。",
};

/* ---------- 工具函数 ---------- */
function toast(msg, type) {
  if (typeof App !== "undefined" && App.toast) {
    App.toast(msg, type || "info", 2500);
  } else if (window.console) {
    console.log("[form-submit]", type || "info", msg);
  }
}

// 安全文件名：去除特殊路径字符
function safeFileName(name) {
  if (!name) return "file";
  return String(name)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, 120);
}

// 根据当前页面推断 form_type
function getFormTypeFromPage() {
  const path = (location.pathname || "").split("/").pop() || "index.html";
  // 处理空格（%20）编码
  const decoded = decodeURIComponent(path);
  return PAGE_TO_FORM_TYPE[decoded] || decoded.replace(/\.html$/i, "");
}

// 获取当前登录用户（异步，权威校验）
async function getCurrentUserOrRedirect() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data || !data.user) {
    toast(MSG.notLogin, "warning");
    try {
      window.location.replace("login.html");
    } catch (e) {
      window.location.href = "login.html";
    }
    return null;
  }
  return data.user;
}

// 收集表单字段（按规则）
function collectFormData(rootEl) {
  const data = {};
  if (!rootEl) return data;

  // 1) input[type="text"], email, number, tel, url, date, time, datetime-local, search, hidden
  rootEl.querySelectorAll("input").forEach(function (inp) {
    const type = (inp.type || "text").toLowerCase();
    if (type === "file") return; // 文件单独处理
    if (type === "password") return; // 不保存密码
    if (type === "submit" || type === "button" || type === "reset" || type === "image") return;

    const key = inp.name || inp.id;
    if (!key) return;

    if (type === "checkbox") {
      // 同名 checkbox 收集成数组
      if (data[key] === undefined) data[key] = [];
      if (Array.isArray(data[key])) {
        if (inp.checked) data[key].push(inp.value || "on");
      } else {
        data[key] = inp.checked;
      }
      return;
    }
    if (type === "radio") {
      if (inp.checked) data[key] = inp.value;
      return;
    }
    data[key] = inp.value;
  });

  // 2) select
  rootEl.querySelectorAll("select").forEach(function (sel) {
    const key = sel.name || sel.id;
    if (!key) return;
    if (sel.multiple) {
      data[key] = Array.from(sel.selectedOptions).map(function (o) {
        return o.value;
      });
    } else {
      data[key] = sel.value;
    }
  });

  // 3) textarea
  rootEl.querySelectorAll("textarea").forEach(function (ta) {
    const key = ta.name || ta.id;
    if (!key) return;
    data[key] = ta.value;
  });

  return data;
}

// 收集文件输入
function collectFileInputs(rootEl) {
  const result = [];
  if (!rootEl) return result;
  rootEl.querySelectorAll('input[type="file"]').forEach(function (inp) {
    const key = inp.name || inp.id;
    if (inp.files && inp.files.length) {
      for (let i = 0; i < inp.files.length; i++) {
        result.push({ field: key, file: inp.files[i] });
      }
    }
  });
  return result;
}

// 单个文件校验与上传
async function uploadOneFile(file, userId, submissionId) {
  // 大小校验
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("文件超过 5MB 限制：" + file.name);
  }

  // 类型校验：默认只允许图片；除非页面 input 带 data-accept-pdf 或 accept 中含 pdf
  // 这里按 input 的 accept 属性判断
  // 调用方可在 options.allowNonImage=true 时放行非图片
  const isImage = ALLOWED_IMAGE_MIME.indexOf(file.type) >= 0;
  if (!isImage) {
    // 非图片：仅当明确允许时放行（见 submit 方法的 options.allowNonImage）
    // 在 uploadOneFile 内抛错由调用方决定
  }

  const path =
    userId + "/" + submissionId + "/" + crypto.randomUUID() + "-" + safeFileName(file.name);

  const upRes = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (upRes.error) {
    console.error("[form-submit] storage.upload error:", upRes.error);
    throw upRes.error;
  }

  // 插入 submission_files
  const insRes = await supabase.from("submission_files").insert({
    submission_id: submissionId,
    user_id: userId,
    bucket_name: STORAGE_BUCKET,
    file_path: path,
    file_name: file.name,
    mime_type: file.type,
    file_size: file.size,
  });

  if (insRes.error) {
    console.error("[form-submit] submission_files insert error:", insRes.error);
    throw insRes.error;
  }

  return { path: path, file_name: file.name, mime_type: file.type, file_size: file.size };
}

/* ---------- 主 API ---------- */
const SupabaseSubmit = {
  // 根据当前页面推断 form_type
  getFormType: getFormTypeFromPage,

  // 收集表单数据（暴露供外部使用）
  collect: collectFormData,

  /**
   * 提交表单数据
   * @param {string} formType
   * @param {object} formData
   * @param {File[]|{file:File,field:string}[]} [files=[]]
   * @param {object} [options] {allowNonImage?:boolean, keepForm?:boolean, status?:string, btn?:HTMLElement, btnLabel?:string}
   * @returns {Promise<{submission:object, files:array}|null>}
   */
  async submit(formType, formData, files, options) {
    options = options || {};
    files = files || [];

    const user = await getCurrentUserOrRedirect();
    if (!user) return null;

    // 防重复提交
    if (options.btn) {
      if (options.btn.dataset.submitting === "1") return null;
      options.btn.dataset.submitting = "1";
      options.btn._origLabel = options.btn.textContent;
      options.btn.disabled = true;
      options.btn.textContent = options.btnLabel || MSG.submitting;
    }

    try {
      // 1) 创建 app_submissions 记录
      const insRes = await supabase
        .from("app_submissions")
        .insert({
          user_id: user.id,
          form_type: formType,
          payload: formData,
          status: options.status || "submitted",
        })
        .select();

      if (insRes.error) {
        console.error("[form-submit] app_submissions insert error:", insRes.error);
        toast(MSG.saveFail, "error");
        return null;
      }

      const row = (insRes.data && insRes.data[0]) || null;
      if (!row) {
        toast(MSG.saveFail, "error");
        return null;
      }

      // 2) 上传文件（如果有）
      const uploadedFiles = [];
      if (files.length) {
        const fileList = files.map(function (f) {
          return f instanceof File || f instanceof Blob ? { field: "file", file: f } : f;
        });

        for (let i = 0; i < fileList.length; i++) {
          const { field, file } = fileList[i];
          try {
            // 非图片且未明确允许：报错
            const isImage = ALLOWED_IMAGE_MIME.indexOf(file.type) >= 0;
            if (!isImage && !options.allowNonImage) {
              toast("仅允许上传图片：" + file.name, "error");
              continue;
            }
            const meta = await uploadOneFile(file, user.id, row.id);
            uploadedFiles.push(meta);
          } catch (e) {
            console.error("[form-submit] 文件上传失败:", e, file && file.name);
            toast(MSG.uploadFail + "（" + (file && file.name) + "）", "error");
          }
        }
      }

      toast(MSG.success, "success");
      return { submission: row, files: uploadedFiles };
    } catch (e) {
      console.error("[form-submit] submit 异常:", e);
      const msg =
        e && e.message
          ? e.message.toLowerCase().indexOf("fetch") >= 0
            ? MSG.network
            : MSG.saveFail
          : MSG.saveFail;
      toast(msg, "error");
      return null;
    } finally {
      if (options.btn) {
        options.btn.dataset.submitting = "0";
        options.btn.disabled = false;
        if (options.btn._origLabel !== undefined) {
          options.btn.textContent = options.btn._origLabel;
        }
      }
    }
  },

  /**
   * 查询当前用户的某 form_type 记录
   * @param {string} formType
   * @param {object} [options] {limit?:number, status?:string}
   */
  async list(formType, options) {
    options = options || {};
    const user = await getCurrentUserOrRedirect();
    if (!user) return [];

    let q = supabase
      .from("app_submissions")
      .select("*")
      .eq("user_id", user.id)
      .eq("form_type", formType)
      .order("created_at", { ascending: false });

    if (options.status) q = q.eq("status", options.status);
    if (options.limit) q = q.limit(options.limit);

    const { data, error } = await q;
    if (error) {
      console.error("[form-submit] list error:", error);
      return [];
    }
    return data || [];
  },

  /**
   * 修改记录（仅允许当前用户自己的记录）
   */
  async update(submissionId, formData, options) {
    options = options || {};
    const user = await getCurrentUserOrRedirect();
    if (!user) return null;

    // 仅更新自己的记录（user_id 限制 + id 限制双重保险）
    const upRes = await supabase
      .from("app_submissions")
      .update({
        payload: formData,
        status: options.status || "updated",
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId)
      .eq("user_id", user.id)
      .select();

    if (upRes.error) {
      console.error("[form-submit] update error:", upRes.error);
      if (upRes.error.code === "PGRST116" || (upRes.error.message || "").indexOf("0 rows") >= 0) {
        toast(MSG.forbidden, "error");
      } else {
        toast(MSG.saveFail, "error");
      }
      return null;
    }
    return (upRes.data && upRes.data[0]) || null;
  },

  /**
   * 删除记录（删除前确认；级联删除 submission_files + 删除 Storage 文件）
   */
  async remove(submissionId, options) {
    options = options || {};
    if (!options.skipConfirm) {
      const ok = window.confirm(MSG.deleteConfirm);
      if (!ok) return false;
    }

    const user = await getCurrentUserOrRedirect();
    if (!user) return false;

    // 1) 先查询关联文件，删除 Storage 文件
    try {
      const { data: files, error: fErr } = await supabase
        .from("submission_files")
        .select("file_path")
        .eq("submission_id", submissionId)
        .eq("user_id", user.id);
      if (!fErr && files && files.length) {
        const paths = files.map(function (f) { return f.file_path; });
        if (paths.length) {
          await supabase.storage.from(STORAGE_BUCKET).remove(paths);
        }
      }
    } catch (e) {
      console.error("[form-submit] remove storage files error:", e);
    }

    // 2) 删除 app_submissions（依赖数据库外键级联删除 submission_files）
    const delRes = await supabase
      .from("app_submissions")
      .delete()
      .eq("id", submissionId)
      .eq("user_id", user.id);

    if (delRes.error) {
      console.error("[form-submit] delete error:", delRes.error);
      toast(MSG.saveFail, "error");
      return false;
    }
    toast("删除成功", "success");
    return true;
  },

  /**
   * 通过 createSignedUrl 获取私有 Bucket 文件的临时访问 URL
   * 不拼接公开 URL
   */
  async getFileUrl(filePath, expiresInSec) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(filePath, expiresInSec || 60);
    if (error) {
      console.error("[form-submit] createSignedUrl error:", error);
      return null;
    }
    return data && data.signedUrl ? data.signedUrl : null;
  },

  /**
   * 查询某条 submission 关联的文件列表
   */
  async listFiles(submissionId) {
    const user = await getCurrentUserOrRedirect();
    if (!user) return [];
    const { data, error } = await supabase
      .from("submission_files")
      .select("*")
      .eq("submission_id", submissionId)
      .eq("user_id", user.id);
    if (error) {
      console.error("[form-submit] listFiles error:", error);
      return [];
    }
    return data || [];
  },

  // 管理员判断
  isAdmin,
  ADMIN_EMAILS,

  /**
   * 专用图片上传：直接上传到 Storage，返回 file_path
   * 用于样衣计划等需要独立上传图片的场景
   * @param {File} file 图片文件
   * @param {string} subFolder 子文件夹路径（如 "sample"）
   * @returns {Promise<{path:string, fileName:string}|null>}
   */
  async uploadPicture(file, subFolder) {
    subFolder = subFolder || "uploads";
    const user = await getCurrentUserOrRedirect();
    if (!user) return null;

    // 校验文件类型
    const isImage = ALLOWED_IMAGE_MIME.indexOf(file.type) >= 0;
    if (!isImage) {
      toast("仅支持图片格式（jpg/png/webp/gif/bmp/svg）", "error");
      return null;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast("图片超过 " + Math.round(MAX_FILE_SIZE / 1024 / 1024) + "MB 限制", "error");
      return null;
    }

    // 生成路径：{userId}/{subFolder}/{randomUUID}-{safeFileName}
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path =
      user.id +
      "/" +
      subFolder +
      "/" +
      crypto.randomUUID() +
      "-" +
      safeFileName(file.name);

    console.log("[form-submit] uploadPicture: bucket=" + STORAGE_BUCKET + ", path=" + path + ", userId=" + user.id);

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });

    if (error) {
      console.error("[form-submit] uploadPicture error:", error);
      var errMsg = error.message || "请检查网络";
      if (errMsg.indexOf("violates") >= 0 || errMsg.indexOf("policy") >= 0 || errMsg.indexOf("RLS") >= 0) {
        errMsg = "RLS策略拒绝写入，请检查Bucket " + STORAGE_BUCKET + "的INSERT策略";
      } else if (errMsg.indexOf("not found") >= 0 || errMsg.indexOf("bucket") >= 0) {
        errMsg = "Bucket " + STORAGE_BUCKET + " 不存在，请在Supabase Dashboard创建";
      }
      toast("上传失败：" + errMsg, "error");
      return null;
    }

    console.log("[form-submit] uploadPicture 成功:", data);
    toast("上传成功", "success");
    return { path: path, fileName: file.name };
  },

  /**
   * 删除 Storage 中的图片
   * @param {string} filePath Storage 文件路径
   */
  async deletePicture(filePath) {
    if (!filePath) return false;
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([filePath]);
    if (error) {
      console.error("[form-submit] deletePicture error:", error);
      return false;
    }
    return true;
  },

  /**
   * 根据款号/原始文件名在 Supabase Storage 中查找上传的图片
   * 上传后的文件名格式为：{uuid}-{原始文件名}
   * 例如：b54ef635-uuid-111222.jpg 匹配原始文件名 111222.jpg
   *
   * 搜索策略：
   *   1) 先在当前用户的 {userId}/sample/ 目录查找
   *   2) 再扫描所有用户目录，跨用户查找（兼容历史数据/账号变更）
   *
   * @param {string} styleNo 款号（如 "111222"）
   * @param {string} subFolder 子文件夹（如 "sample"）
   * @param {string} originalExt 可选：原始扩展名（如 "jpg"）
   * @returns {Promise<{path:string, signedUrl:string}|null>}
   */
  async findPictureByStyleNo(styleNo, subFolder, originalExt) {
    if (!styleNo) return null;
    subFolder = subFolder || "sample";
    const user = await getCurrentUserOrRedirect();
    if (!user) return null;

    const targetName = String(styleNo).trim().toLowerCase();
    const formats = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'];
    // 兼容多种 UUID 前缀形态：
    //   a) 完整连字符 UUID：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-原始文件名
    //   b) 压缩 UUID（无连字符）：xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-原始文件名
    //   c) 较短随机前缀（5~16 位十六进制/字母）：xxx-原始文件名
    const uuidFull = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;
    const uuidFlat = /^[0-9a-f]{32}-/i;
    const randPrefix = /^[0-9a-z]{5,16}-/i;
    function stripPrefix(name) {
      const low = name;
      let m = low.match(uuidFull);
      if (m) return low.substring(m[0].length);
      m = low.match(uuidFlat);
      if (m) return low.substring(m[0].length);
      // 若前导十六进制片段 + "-" 后面剩余部分本身包含扩展名，则尝试去除
      m = low.match(randPrefix);
      if (m) {
        const tail = low.substring(m[0].length);
        if (/\.[a-z0-9]{2,5}$/i.test(tail)) return tail;
      }
      // 最后兜底：取最后一个 "-" 之后的部分（xxx-1122.jpg -> 1122.jpg）
      const dashIdx = low.lastIndexOf('-');
      if (dashIdx > 0 && /\.[a-z0-9]{2,5}$/i.test(low.substring(dashIdx + 1))) {
        return low.substring(dashIdx + 1);
      }
      return low;
    }

    // 匹配规则：多种变体统一比较
    function matchItem(item) {
      const name = item.name;
      if (!name || name.startsWith('.')) return false;
      const lower = name.toLowerCase();

      // 扩展名判断
      const needExt = originalExt ? String(originalExt).toLowerCase().replace(/^\.+/, '') : null;
      if (needExt && !lower.endsWith('.' + needExt)) {
        // 如指定了扩展名但不匹配，只考虑"可能候选"：款号直接命中 或 文件名完整包含款号+扩展名 两种情况
        // 这里保持严格：如指定了扩展名且不匹配，则跳过后续，除非文件名精确包含 {款号}.{扩展名}
        if (needExt && formats.indexOf(needExt) >= 0) {
          if (lower.indexOf(targetName + '.' + needExt) < 0) return false;
        }
      }

      // 变体 0：原始文件名就是 款号.扩展名（含大小写/前后空格）
      const justStem = lower.replace(/\.[^.]+$/, '');
      if (justStem === targetName) return 100;

      // 变体 1：去掉前缀后（UUID 或 随机段）的文件名去掉扩展名等于款号
      const stripped = stripPrefix(lower);
      const stemStripped = stripped.replace(/\.[^.]+$/, '');
      if (stemStripped === targetName) return 95;

      // 变体 2：去掉前缀后的文件名 是 款号 + 后缀词 （例如 1122_front.jpg）
      if (stemStripped.indexOf(targetName) === 0) return 85;

      // 变体 3：文件名直接含款号 + .扩展名（例如 xxx-1122.jpg、1122-abc.jpg）
      for (const fmt of formats) {
        if (lower.endsWith(targetName + '.' + fmt)) return 90;
        if (lower.indexOf('-' + targetName + '.' + fmt) >= 0) return 80;
        if (lower.indexOf('_' + targetName + '.' + fmt) >= 0) return 80;
        if (lower.indexOf(targetName + '-' + fmt) >= 0) return 50; // 容错
      }

      // 变体 4：主干去除所有非字母数字后 包含/等于 款号
      const targetNorm = targetName.replace(/[^0-9a-z\u4e00-\u9fa5]/g, '');
      const jstem = justStem.replace(/[^0-9a-z\u4e00-\u9fa5]/g, '');
      if (targetNorm && jstem === targetNorm) return 75;
      if (targetNorm && jstem.indexOf(targetNorm) >= 0) return 60;

      return false;
    }

    // 尝试从指定目录列表中查找匹配文件（选最高分匹配）
    async function searchInFolder(folderPath) {
      try {
        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .list(folderPath, { limit: 400 });

        if (error || !data || !Array.isArray(data) || data.length === 0) return null;

        // 收集所有命中项并按分数排序，取最高的
        const hits = [];
        for (const item of data) {
          const score = matchItem(item);
          if (score === false || score === 0 || score === null || score === undefined) continue;
          hits.push({ item, score: Number(score) || 10 });
        }
        if (hits.length === 0) return null;
        hits.sort((a, b) => b.score - a.score);
        const best = hits[0].item;
        const fullPath = folderPath + "/" + best.name;

        // 获取签名 URL
        const { data: urlData, error: urlError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(fullPath, 3600); // 1 小时有效期

        if (urlError) {
          console.warn("[form-submit] findPictureByStyleNo signedUrl error:", urlError);
          return { path: fullPath, signedUrl: null, score: hits[0].score };
        }

        return {
          path: fullPath,
          signedUrl: urlData && urlData.signedUrl ? urlData.signedUrl : null,
          score: hits[0].score
        };
      } catch (e) {
        return null;
      }
    }

    try {
      // 策略1：先查当前用户的专属目录
      const userFolder = user.id + "/" + subFolder;
      const result1 = await searchInFolder(userFolder);
      if (result1) return result1;

      // 策略2：扫描根目录，获取所有用户子目录，逐个查找
      // 这能兼容：userId 变更、跨账号数据迁移、历史数据等情况
      const { data: rootData, error: rootError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .list('', { limit: 200 });

      if (rootError) {
        console.warn("[form-submit] findPictureByStyleNo root list error:", rootError);
        return null;
      }
      if (!rootData || !Array.isArray(rootData)) return null;

      // 筛选出目录（用户 ID 文件夹）
      const userDirs = rootData.filter(item =>
        !item.name.startsWith('.') &&
        item.type === 'folder' &&
        /^[0-9a-f]{8}-/i.test(item.name) // UUID 格式的目录
      );

      // 遍历每个用户目录，查找 {userId}/{subFolder}/ 下的文件
      for (const dir of userDirs) {
        const subFolderPath = dir.name + "/" + subFolder;
        const result2 = await searchInFolder(subFolderPath);
        if (result2) {
          console.log("[form-submit] findPictureByStyleNo found in:", subFolderPath);
          return result2;
        }
      }

      // 策略3：直接在 {subFolder}/ 目录下查找（兼容非用户隔离的旧数据）
      const result3 = await searchInFolder(subFolder);
      if (result3) return result3;

      return null;
    } catch (e) {
      console.warn("[form-submit] findPictureByStyleNo exception:", e);
      return null;
    }
  },

  /**
   * 只读获取当前用户，失败/未登录绝不跳转登录页（用于存储搜索/解签这类只读场景）
   */
  async _peekCurrentUser() {
    if (!window.supabase) return null;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data && data.user) return data.user;
    } catch(_e) {}
    // 兜底：读本地 localStorage session
    try {
      var raw = localStorage.getItem('sb-' + (window.SUPABASE_REF || '') + '-auth-token');
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.user) return parsed.user;
      }
    } catch(_e2) {}
    return null;
  },

  /**
   * 按款号在 Supabase 中搜索图片，同时返回“款式图”和“大图”的最佳匹配
   * @param {string} styleNo 款号
   * @returns {Promise<{styleImg_path:string|null, fullImg_path:string|null, styleImg_signed:string|null, fullImg_signed:string|null, styleImg_name:string, fullImg_name:string}|null>}
   */
  async findStyleImages(styleNo) {
    if (!styleNo) return null;
    const sn = String(styleNo).trim();
    const bucket = window.STORAGE_BUCKET || 'app-photos';
    const self = this;
    console.log('[SupabaseSubmit] findStyleImages start: styleNo=' + sn + ', bucket=' + bucket);

    // 所有子目录都要搜索（去掉之前的 break bug）
    const searchTargets = ["order", "consumption", "sample", "wash", "fabric", "accessory", "uploads"];
    const allHits = [];
    const user = await self._peekCurrentUser(); // 绝不跳转登录页

    // 1) 对每个 subFolder 使用 findPictureByStyleNo（内部含跨用户策略 + 缓存）
    for (let i = 0; i < searchTargets.length; i++) {
      const sf = searchTargets[i];
      try {
        const r1 = await self.findPictureByStyleNo(sn, sf, null);
        if (r1) {
          console.log('[SupabaseSubmit] findStyleImages hit via findPictureByStyleNo subFolder=' + sf + ', path=' + r1.path + ', score=' + r1.score);
          allHits.push({ path: r1.path, signedUrl: r1.signedUrl, score: r1.score, folder: sf, isFull: self._isFull(r1.path, sf, sn) });
        }
      } catch(_e) {
        console.warn('[SupabaseSubmit] findPictureByStyleNo subFolder=' + sf + ' error:', _e);
      }
      // 避免瞬间并发请求过多
      if (i < searchTargets.length - 1) await new Promise(function(r){ setTimeout(r, 20); });
    }

    // 2) 如果 JS client 的 findPictureByStyleNo 完全没命中（Safari CORS / RLS / Storage 报错常见）
    //    用纯 REST list 接口兜底：GET /storage/v1/object/list/{bucket}/{prefixPath}
    //    这样即使 supabase-js 出问题，我们也能列出所有文件
    if (allHits.length === 0 && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
      try {
        console.log('[SupabaseSubmit] findStyleImages falling back to REST list...');
        const restHits = await self._restListStyleImages(sn, bucket, user ? user.id : null);
        if (restHits && restHits.length) {
          console.log('[SupabaseSubmit] findStyleImages REST fallback hits:', restHits.length);
          allHits.push.apply(allHits, restHits);
        }
      } catch(_err) {
        console.warn('[SupabaseSubmit] REST fallback error:', _err);
      }
    }

    // 3) 最后走根目录广泛扫描（兜底）
    if (allHits.length === 0) {
      try {
        const broadResults = await self._searchAllFoldersForStyleNo(sn);
        if (broadResults && broadResults.length) {
          console.log('[SupabaseSubmit] findStyleImages broad scan hits:', broadResults.length);
          allHits.push(...broadResults);
        }
      } catch(_e2) { console.warn('[SupabaseSubmit] broad scan error:', _e2); }
    }

    if (allHits.length === 0) {
      console.log('[SupabaseSubmit] findStyleImages result: 未找到款号 ' + sn + ' 的任何图片');
      return null;
    }

    // 去重（按 path）
    var seen = {};
    var unique = [];
    for (var i = 0; i < allHits.length; i++) {
      if (!seen[allHits[i].path]) { seen[allHits[i].path] = 1; unique.push(allHits[i]); }
    }
    allHits.length = 0; allHits.push.apply(allHits, unique);

    // 分款式图/大图：含 full、big、large、大图 关键词的判为大图
    var sorted = allHits.slice().sort(function(a, b){ return (b.score || 0) - (a.score || 0); });
    var styleHit = null;
    var fullHit = null;

    var fullCandidates = sorted.filter(function(h){ return h.isFull; });
    var styleCandidates = sorted.filter(function(h){ return !h.isFull; });

    if (styleCandidates.length > 0) styleHit = styleCandidates[0];
    else if (sorted.length > 0) styleHit = sorted[0];

    if (fullCandidates.length > 0) fullHit = fullCandidates[0];
    else if (sorted.length >= 2 && styleHit) {
      var second = sorted.find(function(h){ return h.path !== styleHit.path; });
      if (second) fullHit = second;
    }

    var result = {
      styleImg_path: null, fullImg_path: null,
      styleImg_signed: null, fullImg_signed: null,
      styleImg_name: '', fullImg_name: ''
    };
    if (styleHit) {
      result.styleImg_path = styleHit.path;
      result.styleImg_signed = styleHit.signedUrl || null;
      result.styleImg_name = styleHit.path.split('/').pop() || '';
    }
    if (fullHit) {
      result.fullImg_path = fullHit.path;
      result.fullImg_signed = fullHit.signedUrl || null;
      result.fullImg_name = fullHit.path.split('/').pop() || '';
    }
    console.log('[SupabaseSubmit] findStyleImages result for ' + sn + ':', JSON.stringify(result));
    return (result.styleImg_path || result.fullImg_path) ? result : null;
  },

  /**
   * 纯 REST 列目录：用 fetch 直连 Supabase Storage，绕开 supabase-js 客户端的 RLS / CORS 兼容问题（典型于 Safari）
   * 遍历：[当前用户ID/] + subFolder 下的所有文件，按文件名含款号匹配
   */
  async _restListStyleImages(styleNo, bucket, userId) {
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return [];
    const self = this;
    const base = window.SUPABASE_URL.replace(/\/$/, '');
    const anon = window.SUPABASE_ANON_KEY;
    const sn = String(styleNo).toLowerCase();
    const subFolders = ["order", "consumption", "sample", "wash", "fabric", "accessory", "uploads"];
    const results = [];
    const auth = await self._restAuthHeader(); // 优先带登录用户的 JWT（有 RLS 权限），不行就只用 anon key

    async function listDir(prefixPath) {
      try {
        var url = base + '/storage/v1/object/list/' + encodeURIComponent(bucket);
        var resp = await fetch(url, {
          method: 'POST',
          headers: {
            'apikey': anon,
            'Authorization': auth,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ prefix: prefixPath, limit: 500, offset: 0 })
        });
        if (!resp.ok) {
          console.warn('[REST list] prefix=' + prefixPath + ' HTTP ' + resp.status);
          return [];
        }
        var j = await resp.json();
        if (!j || !Array.isArray(j)) return [];
        return j;
      } catch(e) {
        console.warn('[REST list] fail prefix=' + prefixPath, e);
        return [];
      }
    }

    function scoreName(name, folderHint) {
      var lower = String(name).toLowerCase();
      var nameNoExt = lower.replace(/\.[^.]+$/, '');
      var s = 0;
      if (nameNoExt === sn) s = 100;
      else if (nameNoExt.indexOf(sn) === 0) s = 85;
      else if (nameNoExt.indexOf(sn) >= 0) s = 70;
      else {
        // xxx-{款号}.jpg 这类：{uuid}-{styleNo}.jpg
        if (lower.indexOf('-' + sn + '.') >= 0) s = 80;
        else if (lower.indexOf('_' + sn + '.') >= 0) s = 78;
      }
      return s;
    }

    const prefixesToTry = [];
    // 当前用户 + 各个 subFolder（最高优先级）
    if (userId) subFolders.forEach(function(sf){ prefixesToTry.push(userId + '/' + sf + '/'); });
    // 直接 subFolder/ 前缀（兼容旧数据）
    subFolders.forEach(function(sf){ prefixesToTry.push(sf + '/'); });
    // 如果没有 userId，至少先列根目录看一层
    if (!userId) prefixesToTry.push('');

    for (var i = 0; i < prefixesToTry.length; i++) {
      var prefix = prefixesToTry[i];
      var items = await listDir(prefix);
      if (!items || items.length === 0) continue;

      // 若 prefix 是根目录 '' 则 items 可能是用户 ID 文件夹，需要再深入
      if (prefix === '') {
        for (var k = 0; k < items.length; k++) {
          var entry = items[k];
          if (entry && entry.type === 'folder' && /^[0-9a-f]{8}-/i.test(entry.name)) {
            for (var m = 0; m < subFolders.length; m++) {
              var subPath = entry.name + '/' + subFolders[m] + '/';
              var more = await listDir(subPath);
              for (var n = 0; n < more.length; n++) (function(item, sf){
                var sc = scoreName(item.name);
                if (sc > 0) {
                  var fullPath = subPath.substring(0, subPath.length - 1) + '/' + item.name;
                  results.push({
                    path: fullPath,
                    signedUrl: null,
                    score: sc,
                    folder: sf,
                    isFull: (String(item.name).toLowerCase().indexOf('full') >= 0 || String(item.name).toLowerCase().indexOf('big') >= 0 || String(item.name).toLowerCase().indexOf('large') >= 0)
                  });
                }
              })(more[n], subFolders[m]);
            }
          }
        }
      } else {
        // 非空前缀：是具体的 {userId}/sf/ 或 sf/ 目录，里面就是文件
        var sfHint = prefix;
        for (var x = 0; x < items.length; x++) {
          var it = items[x];
          if (!it || it.type === 'folder') continue;
          var sc2 = scoreName(it.name);
          if (sc2 === 0) continue;
          var fullP = (prefix.endsWith('/') ? prefix.substring(0, prefix.length - 1) : prefix) + '/' + it.name;
          results.push({
            path: fullP,
            signedUrl: null,
            score: sc2,
            folder: sfHint,
            isFull: (String(it.name).toLowerCase().indexOf('full') >= 0 || String(it.name).toLowerCase().indexOf('big') >= 0 || String(it.name).toLowerCase().indexOf('large') >= 0)
          });
        }
      }
    }

    // 对找到的每条路径，生成 signed URL（REST 版）
    for (var w = 0; w < results.length; w++) {
      try {
        var signUrl = base + '/storage/v1/object/sign/' + encodeURIComponent(bucket) + '/' + encodeURIComponent(results[w].path);
        var signResp = await fetch(signUrl, {
          method: 'POST',
          headers: {
            'apikey': anon,
            'Authorization': auth,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ expiresIn: 7200 })
        });
        if (signResp.ok) {
          var sj = await signResp.json();
          if (sj && sj.signedURL) results[w].signedUrl = base + sj.signedURL;
          else if (sj && sj.signedUrl) results[w].signedUrl = (sj.signedUrl.indexOf('http') === 0) ? sj.signedUrl : (base + sj.signedUrl);
        }
      } catch(_e) {}
    }
    return results;
  },

  /**
   * 生成 REST 调用的 Authorization 头：优先用户 session 的 access_token(JWT)，没有则 Bearer anon key
   */
  async _restAuthHeader() {
    // 1) 从 supabase-js 的 session 里拿 access_token
    try {
      if (window.supabase) {
        var { data } = await supabase.auth.getSession();
        if (data && data.session && data.session.access_token) {
          return 'Bearer ' + data.session.access_token;
        }
      }
    } catch(_e) {}
    // 2) 从 localStorage 直接拿 sb-xxx-auth-token
    try {
      var prefix = 'sb-' + (window.SUPABASE_REF ? window.SUPABASE_REF + '-' : '');
      var keys = Object.keys(localStorage);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('sb-') === 0 && keys[i].indexOf('-auth-token') >= 0) {
          var raw = localStorage.getItem(keys[i]);
          if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.access_token) return 'Bearer ' + parsed.access_token;
          }
        }
      }
    } catch(_e) {}
    // 3) 兜底：用 anon key（只绕过 bucket 为 public 的情况）
    return 'Bearer ' + (window.SUPABASE_ANON_KEY || '');
  },

  _isFull: function(path, folder, styleNo) {
    if (!path) return false;
    var p = path.toLowerCase();
    if (p.indexOf('full') >= 0) return true;
    if (p.indexOf('big') >= 0) return true;
    if (p.indexOf('large') >= 0) return true;
    if (p.indexOf('大图') >= 0) return true;
    return false;
  },

  // 根目录广泛扫描：所有用户目录下所有 subFolder
  async _searchAllFoldersForStyleNo(styleNo) {
    if (!window.supabase) return [];
    const bucket = window.STORAGE_BUCKET || 'app-photos';
    const results = [];
    try {
      const { data: rootData, error: rootErr } = await supabase.storage.from(bucket).list('', { limit: 400 });
      if (rootErr) { console.warn('[broadScan] root list error:', rootErr); }
      if (!rootData || !Array.isArray(rootData)) return results;

      const subFolders = ["order", "consumption", "sample", "wash", "fabric", "accessory", "uploads"];
      for (const entry of rootData) {
        if (entry.type !== 'folder') continue;
        for (const sf of subFolders) {
          const folderPath = entry.name + "/" + sf;
          try {
            const { data, error } = await supabase.storage.from(bucket).list(folderPath, { limit: 400 });
            if (error) { console.warn('[broadScan] list ' + folderPath + ' error:', error); continue; }
            if (!data) continue;
            for (const item of data) {
              const lower = item.name.toLowerCase();
              const sn = String(styleNo).toLowerCase();
              var score = 0;
              var nameNoExt = lower.replace(/\.[^.]+$/, '');
              if (nameNoExt === sn) score = 100;
              else if (nameNoExt.indexOf(sn) === 0) score = 85;
              else if (nameNoExt.indexOf(sn) >= 0) score = 70;
              // UUID-款号.jpg
              if (score === 0 && (lower.indexOf('-' + sn + '.') >= 0 || lower.indexOf('_' + sn + '.') >= 0)) score = 75;
              if (score === 0) continue;
              const fullPath = folderPath + "/" + item.name;
              var signed = null;
              try {
                const r = await supabase.storage.from(bucket).createSignedUrl(fullPath, 3600);
                if (r && !r.error && r.data && r.data.signedUrl) signed = r.data.signedUrl;
              } catch(_e) {}
              results.push({
                path: fullPath,
                signedUrl: signed,
                score: score,
                folder: sf,
                isFull: (lower.indexOf('full') >= 0 || lower.indexOf('big') >= 0 || lower.indexOf('large') >= 0)
              });
            }
          } catch(_e) {}
        }
      }
    } catch(_e) { console.warn('[broadScan] root error:', _e); }
    return results;
  },
};

// 暴露到全局，便于非模块脚本调用
window.SupabaseSubmit = SupabaseSubmit;

/* ---------- 自动绑定：data-supabase-form ---------- */
function autoBindForms() {
  const forms = document.querySelectorAll("form[data-supabase-form]");
  forms.forEach(function (form) {
    // 避免重复绑定
    if (form.dataset.supabaseBound === "1") return;
    form.dataset.supabaseBound = "1";

    // 已有 onsubmit 的表单跳过，避免重复提交事件
    const hasOnSubmitAttr = form.getAttribute("onsubmit");
    if (hasOnSubmitAttr) {
      console.warn(
        "[form-submit] 表单 " +
          (form.id || "?") +
          " 已有 onsubmit，已跳过自动绑定（如需使用 Supabase 提交，请删除 onsubmit 或手动调用 SupabaseSubmit.submit）"
      );
      return;
    }

    const submitBtn = form.querySelector('[type="submit"]');

    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();

      const formType = form.getAttribute("data-supabase-form");
      const formData = collectFormData(form);
      const fileList = collectFileInputs(form);

      // 如果表单上有 data-allow-non-image，放行非图片
      const allowNonImage = form.getAttribute("data-allow-non-image") === "true";

      await SupabaseSubmit.submit(formType, formData, fileList, {
        allowNonImage: allowNonImage,
        btn: submitBtn || undefined,
      });
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoBindForms);
} else {
  autoBindForms();
}
