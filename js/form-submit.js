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
