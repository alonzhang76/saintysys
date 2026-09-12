/* ===== CloudBase 客户端 + Supabase 兼容层 cloudbase.js =====
 *
 * 本项目已从 Supabase 迁移到腾讯云开发 CloudBase（https://tcb.cloud.tencent.com）
 *
 * 工作原理：
 *   - 通过 CDN 加载 CloudBase JS SDK v3（@cloudbase/js-sdk，UMD 版）
 *   - 在其上构建一层与 supabase-js 兼容的 API（auth / from / storage），
 *     业务代码无需改动即可继续使用 window.supabase.* 调用
 *   - 底层全部走 CloudBase 云数据库 / 云存储 / 登录认证
 *
 * 部署前请把下面占位符替换成你自己的 CloudBase 配置：
 *   - CLOUDBASE_ENV          云开发环境 ID（如 aiot-xxxxxxxx），控制台首页可查
 *   - CLOUDBASE_REGION       环境所属地域（ap-shanghai / ap-guangzhou / ap-singapore）
 *   - CLOUDBASE_ACCESS_KEY   Publishable Key（可选但推荐，云开发平台/API密钥 中获取）
 *
 * 安全说明：
 *   - Publishable Key / 环境 ID 可以暴露在浏览器
 *   - 不要把云函数密钥 SecretId/SecretKey 放到前端
 *   - 数据权限由 CloudBase 数据库安全规则（集合权限）保证
 */

// ===== CloudBase 环境配置（请替换为你的真实值）=====
export const CLOUDBASE_ENV = "onlineofficework-d4e93l98bdf879e";
export const CLOUDBASE_REGION = "ap-shanghai";
// Publishable Key：可暴露在浏览器，用于匿名/公开资源访问，降低 MAU 消耗
export const CLOUDBASE_ACCESS_KEY = "";

// ===== 存储配置 =====
// CloudBase 使用环境内置云存储（默认桶），此名称仅作为业务字段记录文件归属
export const STORAGE_BUCKET = "app-photos";

// 单文件最大 10MB
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

// 允许的图片 MIME 类型
export const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
];

// ===== 会话缓存键（同步登录守卫 auth-guard.js / common.js 读取此键）=====
export const AUTH_SESSION_KEY = "tcb_auth_session";

// 列目录使用云函数（CloudBase SDK 无前端列目录 API，需部署 tcb-file-list 云函数）
export const FILE_LIST_FUNCTION = "tcb-file-list";

// 配置占位符检查
if (!CLOUDBASE_ENV || CLOUDBASE_ENV === "your-env-id") {
  console.warn(
    "[cloudbase.js] CLOUDBASE_ENV 仍是占位符，请在 js/cloudbase.js 中填入真实环境 ID 后再使用。"
  );
}

/* ---------- SDK 加载（UMD 动态注入 + CDN 容错） ---------- */
// CloudBase JS SDK v3（webv3，与新版 CloudBase 环境认证 v2 兼容）
const SDK_VERSION = "3.9.3";
const CDN_LIST = [
  "https://static.cloudbase.net/cloudbase-js-sdk/" + SDK_VERSION + "/cloudbase.full.js",
  "https://imgcache.qq.com/qcloud/cloudbase-js-sdk/" + SDK_VERSION + "/cloudbase.full.js",
];

var _sdkPromise = null;
function loadSdk() {
  if (window.cloudbase && typeof window.cloudbase.init === "function") {
    return Promise.resolve(window.cloudbase);
  }
  if (_sdkPromise) return _sdkPromise;

  _sdkPromise = new Promise(function (resolve, reject) {
    var idx = 0;
    function tryNext() {
      if (idx >= CDN_LIST.length) {
        reject(new Error("CloudBase SDK 所有 CDN 均加载失败，请检查网络连接"));
        return;
      }
      var script = document.createElement("script");
      script.src = CDN_LIST[idx];
      script.async = true;
      script.onload = function () {
        if (window.cloudbase && typeof window.cloudbase.init === "function") {
          resolve(window.cloudbase);
        } else {
          idx++;
          tryNext();
        }
      };
      script.onerror = function () {
        idx++;
        tryNext();
      };
      document.head.appendChild(script);
    }
    tryNext();
  });
  return _sdkPromise;
}

/* ---------- 图形验证码弹窗（登录失败 5 次后触发） ---------- */
// v3 SDK 通过 adapter 的 openURIWithCallback 回调要求展示验证码
var _authRefForCaptcha = null;

// 显示验证码弹窗，返回 Promise（用户点确定并校验成功后 resolve）
function showCaptchaModal(captcha) {
  return new Promise(function (resolve, reject) {
    var state = {
      captchaData: captcha.captchaData, // Base64 图片
      state: captcha.state,
      token: captcha.token,
    };

    // 遮罩
    var mask = document.createElement("div");
    mask.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;";

    var box = document.createElement("div");
    box.style.cssText = "background:#fff;border-radius:10px;padding:24px;width:320px;box-shadow:0 8px 30px rgba(0,0,0,.2);font-family:system-ui,sans-serif;";
    box.innerHTML =
      '<div style="font-size:16px;font-weight:600;margin-bottom:14px;text-align:center;">安全验证</div>' +
      '<div style="text-align:center;margin-bottom:12px;cursor:pointer;" title="点击刷新验证码">' +
        '<img id="tcb-cap-img" style="height:48px;border:1px solid #ddd;border-radius:4px;" alt="验证码"/>' +
      '</div>' +
      '<input id="tcb-cap-input" type="text" maxlength="6" placeholder="请输入图中字符" ' +
        'style="width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #ccc;border-radius:6px;font-size:15px;margin-bottom:12px;"/>' +
      '<div style="display:flex;gap:10px;">' +
        '<button id="tcb-cap-cancel" style="flex:1;padding:9px;border:1px solid #ccc;background:#f5f5f5;border-radius:6px;cursor:pointer;font-size:14px;">取消</button>' +
        '<button id="tcb-cap-ok" style="flex:1;padding:9px;border:none;background:#075985;color:#fff;border-radius:6px;cursor:pointer;font-size:14px;">确定</button>' +
      '</div>' +
      '<div id="tcb-cap-err" style="color:#dc2626;font-size:12px;margin-top:8px;text-align:center;min-height:16px;"></div>';
    mask.appendChild(box);
    document.body.appendChild(mask);

    var img = box.querySelector("#tcb-cap-img");
    var input = box.querySelector("#tcb-cap-input");
    var errEl = box.querySelector("#tcb-cap-err");
    var okBtn = box.querySelector("#tcb-cap-ok");

    function renderImg() {
      if (state.captchaData) {
        img.src = state.captchaData.indexOf("data:") === 0
          ? state.captchaData
          : "data:image/png;base64," + state.captchaData;
      }
    }
    renderImg();
    setTimeout(function () { input.focus(); }, 100);

    function cleanup() {
      if (mask.parentNode) mask.parentNode.removeChild(mask);
    }

    // 刷新验证码
    img.onclick = function () {
      if (!_authRefForCaptcha || typeof _authRefForCaptcha.createCaptchaData !== "function") return;
      errEl.textContent = "刷新中…";
      _authRefForCaptcha.createCaptchaData({ state: state.state })
        .then(function (res) {
          state.captchaData = res.data || res.captchaData;
          state.token = res.token || state.token;
          renderImg();
          errEl.textContent = "";
          input.value = "";
          input.focus();
        })
        .catch(function () { errEl.textContent = "刷新失败，请重试"; });
    };

    box.querySelector("#tcb-cap-cancel").onclick = function () {
      cleanup();
      reject(new Error("用户取消了验证码"));
    };

    function submit() {
      var key = input.value.trim();
      if (!key) { errEl.textContent = "请输入验证码"; return; }
      if (!_authRefForCaptcha || typeof _authRefForCaptcha.verifyCaptchaData !== "function") {
        errEl.textContent = "验证码模块不可用";
        return;
      }
      okBtn.disabled = true;
      _authRefForCaptcha.verifyCaptchaData({ token: state.token, key: key })
        .then(function (verifyResult) {
          cleanup();
          resolve(verifyResult);
        })
        .catch(function () {
          errEl.textContent = "验证码错误，请重试";
          okBtn.disabled = false;
          input.value = "";
          input.focus();
          // 自动刷新一张
          img.onclick && img.onclick();
        });
    }
    okBtn.onclick = submit;
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") submit();
    });
  });
}

// 注册验证码 adapter（必须在 init 之前调用）
function setupCaptchaAdapter(cb) {
  if (typeof cb.useAdapters !== "function" || typeof cb.parseCaptcha !== "function") return;
  try {
    var adapter = {
      captchaOptions: {
        openURIWithCallback: async function (url) {
          var parsed;
          try {
            parsed = cb.parseCaptcha(url);
          } catch (e) {
            throw new Error("验证码数据解析失败");
          }
          return await showCaptchaModal(parsed);
        },
      },
    };
    cb.useAdapters(adapter, {});
  } catch (e) {
    console.warn("[cloudbase.js] 验证码 adapter 注册失败:", e && e.message ? e.message : e);
  }
}

/* ---------- 初始化 CloudBase App ---------- */
var _appPromise = loadSdk()
  .then(function (cb) {
    // v3 验证码 adapter 必须在 init 之前注册
    setupCaptchaAdapter(cb);
    var initOpts = {
      env: CLOUDBASE_ENV,
      region: CLOUDBASE_REGION,
    };
    // Publishable Key 来源：代码常量 → window.CLOUDBASE_ACCESS_KEY → localStorage（控制台临时测试用）
    var _pk = CLOUDBASE_ACCESS_KEY || window.CLOUDBASE_ACCESS_KEY ||
      (function () { try { return localStorage.getItem("cb_publishable_key") || ""; } catch (_e) { return ""; } })();
    if (_pk) initOpts.accessKey = _pk;
    var app = cb.init(initOpts);
    console.log("[cloudbase.js] ✅ CloudBase SDK v3 已初始化 env=" + CLOUDBASE_ENV);
    // 保存 auth 引用给验证码弹窗使用
    _authRefForCaptcha = getAuthInstance(app);
    // 未登录时尝试匿名登录（需在控制台开启"匿名登录"），保证共享数据可读
    ensureLogin(app);
    return app;
  })
  .catch(function (err) {
    console.error("[cloudbase.js] ❌ CloudBase SDK 初始化失败:", err && err.message ? err.message : err);
    return null;
  });

function getApp() {
  return _appPromise;
}

// 缓存 auth 实例（v3 SDK 要求每个 app 只能有一个 auth 对象）
var _cachedAuth = null;
var _cachedApp = null;

// v3 SDK：app.auth 是属性（对象），不是函数
function getAuthInstance(app) {
  if (!app) return null;
  // 同一个 app 复用同一个 auth 实例
  if (_cachedAuth && _cachedApp === app) return _cachedAuth;
  try {
    var auth;
    if (typeof app.auth === "function") {
      // v2 风格：app.auth() 返回 auth 对象
      auth = app.auth();
    } else {
      // v3 风格：app.auth 直接是 auth 对象
      auth = app.auth;
    }
    if (auth) {
      _cachedAuth = auth;
      _cachedApp = app;
    }
    return auth;
  } catch (e) {
    return null;
  }
}

/* ---------- 会话缓存（同步读取用） ---------- */
function saveSessionCache(user) {
  try {
    if (user) {
      localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ user: user, ts: Date.now() }));
    }
  } catch (e) {}
}

function clearSessionCache() {
  try {
    localStorage.removeItem(AUTH_SESSION_KEY);
  } catch (e) {}
}

function readSessionCache() {
  try {
    var raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.user) return parsed;
    }
  } catch (e) {}
  return null;
}

/* ---------- CloudBase 用户 → Supabase 风格用户 ---------- */
function mapUser(raw) {
  if (!raw) return null;
  var id = raw.userId || raw.uid || raw._id || raw.id || raw.sub || "";
  var email = raw.email || raw.primaryEmail || "";
  var custom = raw.customAttributes || raw.custom_attributes || raw.user_metadata || {};
  if (typeof custom === "string") {
    try { custom = JSON.parse(custom); } catch (e) { custom = {}; }
  }
  if (!custom || typeof custom !== "object") custom = {};
  var username = raw.username || raw.nickname || raw.nickName || (email ? email.split("@")[0] : "用户");
  var meta = Object.assign({}, custom);
  if (!meta.username) meta.username = username;
  // PG 模式：匿名用户的 JWT role=anon，写操作会被拒（401）；显式标记以便上层拦截
  var isAnon = !!(raw.isAnonymous || raw.is_anonymous ||
    (raw.user_metadata && (raw.user_metadata.is_anonymous || raw.user_metadata.isAnonymous)) ||
    /^anon/i.test(raw.scope || "") ||
    (raw.app_metadata && raw.app_metadata.provider === "anonymous"));
  return {
    id: id,
    sub: id,
    email: email,
    phone: raw.phone || raw.phoneNumber || "",
    is_anonymous: isAnon,
    user_metadata: meta,
    app_metadata: { provider: raw.provider || "cloudbase" },
    created_at: raw.createdAt || raw.createAt || raw.createTime || raw.create_date || "",
    last_sign_in_at: raw.lastLoginAt || raw.last_login_at || "",
  };
}

// 从 CloudBase 拉取当前登录用户（兼容多种返回形态）
async function fetchUser(app) {
  var auth = getAuthInstance(app);
  if (!auth) return null;
  // v3: getCurrentUser()
  if (typeof auth.getCurrentUser === "function") {
    try {
      var u = await auth.getCurrentUser();
      if (u) return mapUser(u);
    } catch (e) { /* 继续尝试其他方法 */ }
  }
  // v2 兜底: getUser()
  if (typeof auth.getUser === "function") {
    try {
      var r = await auth.getUser();
      var u2 = (r && r.user) || (r && r.data && r.data.user) || null;
      if (u2) return mapUser(u2);
      if (r && r.data && r.data.userId) return mapUser(r.data);
    } catch (e) { /* 继续尝试其他方法 */ }
  }
  // 兜底 getUserInfo()（v1 风格，可能直接返回用户对象）
  if (typeof auth.getUserInfo === "function") {
    try {
      var r2 = await auth.getUserInfo();
      var u3 = (r2 && (r2.userInfo || r2.user)) || r2 || null;
      if (u3 && (u3.userId || u3.uid || u3._id)) return mapUser(u3);
    } catch (e) { /* 忽略 */ }
  }
  return null;
}

// 尝试获取 access_token（部分场景诊断用）
async function fetchAccessToken(app) {
  var auth = getAuthInstance(app);
  if (!auth) return null;
  try {
    if (typeof auth.getAccessToken === "function") {
      var t = await auth.getAccessToken();
      if (typeof t === "string") return t;
      if (t && t.accessToken) return t.accessToken;
    }
  } catch (e) {}
  return null;
}

// 未登录时尝试匿名登录（需在云开发控制台"身份认证→登录方式"开启匿名登录）
async function ensureLogin(app) {
  // 登录页不做匿名登录：用户会主动用邮箱密码登录，
  // 若此处发起匿名登录会与邮箱登录竞争并覆盖会话，导致 JWT role=anon、写操作 401
  if (typeof window !== "undefined" && window.location &&
      /login\.html$/i.test(window.location.pathname || window.location.href)) {
    return;
  }
  try {
    var auth = getAuthInstance(app);
    if (!auth) return;
    var hasLogin = false;
    if (typeof auth.hasLoginState === "function") {
      try {
        var ls = await auth.hasLoginState();
        hasLogin = !!ls;
      } catch (e) {}
    }
    if (hasLogin) return;
    var cached = readSessionCache();
    if (cached && cached.user && cached.user.id) return; // 已有本地会话，等 getUser 校验
    if (typeof auth.signInAnonymously !== "function") return;
    // 再次校验：等待 hasLoginState 可能与邮箱登录存在竞争，
    // 真正发起匿名登录前再确认一次，避免覆盖刚完成的邮箱登录会话
    if (typeof auth.hasLoginState === "function") {
      try { if (await auth.hasLoginState()) return; } catch (_e) {}
    }
    try {
      // v3.9.3: 返回 { data: {user, session}, error }
      var res = await auth.signInAnonymously();
      if (res && res.error) {
        console.warn("[cloudbase.js] 匿名登录失败（请在控制台身份认证→登录方式中开启「匿名登录」）:", res.error.message || res.error.code || "");
        return;
      }
      if (res && res.data && res.data.user) {
        console.log("[cloudbase.js] 已匿名登录（共享数据可读）");
      }
    } catch (eAnon) {
      console.warn("[cloudbase.js] 匿名登录失败（请在控制台开启「匿名登录」）:", eAnon && eAnon.message ? eAnon.message : eAnon);
    }
  } catch (e) {
    console.warn("[cloudbase.js] 匿名登录不可用（请在控制台开启匿名登录）:", e && e.message ? e.message : e);
  }
}

/* ===== JWT 写权限诊断 =====
 * rdb REST 按 access_token 中的 role claim 映射数据库角色：
 *   anon          → 只有 SELECT（写返回 permission denied / 401）
 *   authenticated → GRANT 后可读写
 * 页面初始化约 5 秒后自动打印一次；也可在控制台执行 __cbDiag() 手动探测
 * （含一个「更新不存在 id」的非破坏性写探测，不会改动任何数据）。
 */
function _decodeJwtPayload(token) {
  try {
    var part = String(token).split(".")[1];
    part = part.replace(/-/g, "+").replace(/_/g, "/");
    while (part.length % 4) part += "=";
    var json = decodeURIComponent(escape(atob(part)));
    return JSON.parse(json);
  } catch (e) { return null; }
}

async function cbDiag(probeWrite) {
  var app = await getApp();
  var out = { sdkReady: !!app, hasToken: false, role: null, sub: null, exp: null, isAnonymous: null, user: null, rawClaims: null };
  var token = null;
  try {
    token = await fetchAccessToken(app);
    out.hasToken = !!token;
    var p = token ? _decodeJwtPayload(token) : null;
    if (p) {
      out.rawClaims = p; // 完整 claims，便于定位 role 是否嵌套/字段名差异
      out.role = p.role || null;
      out.sub = p.sub || null;
      out.exp = p.exp ? new Date(p.exp * 1000).toLocaleString() : null;
      out.isAnonymous = !!(p.is_anonymous || p.isAnonymous ||
        (typeof p.sub === "string" && /^anon/i.test(p.sub)));
    }
    out.user = await fetchUser(app);
  } catch (e) { out.error = e && e.message ? e.message : String(e); }
  if (probeWrite && token) {
    try {
      // 更新一个必然不存在的 id：过了 GRANT → 200/0 行；权限不足 → 401/403 permission denied
      var res = await fetch(
        "https://" + CLOUDBASE_ENV + ".api.tcloudbasegateway.com/v1/rdb/rest/app_data_store?id=eq.__diag_perm_probe__",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body: JSON.stringify({ data: {} }),
        }
      );
      out.writeProbeStatus = res.status;
      out.writeProbeBody = (await res.text()).slice(0, 300);
    } catch (e2) { out.writeProbeError = String(e2); }
  }
  var verdict = out.role === "authenticated"
    ? "JWT 是 authenticated（登录身份）；若写仍失败 → 数据库 GRANT/RLS 问题，请执行 cloudbase-pg-setup.sql 第 5 节"
    : (out.role === "anon"
      ? "⚠️ JWT 是 anon（匿名身份）！写必然 401。请退出后重新邮箱登录"
      : "⚠️ token 没有 role claim（非 PG 登录令牌）。请：1) 退出并重新邮箱登录（让 SDK 换发新令牌）；2) 若仍如此，在 cloudbase.js 顶部填入 Publishable Key（控制台→身份认证→凭证，pk 开头）后重新部署");
  out.verdict = verdict;
  console.log("%c[cloudbase.js] 🔑 JWT 诊断\n" + JSON.stringify(out, null, 2) + "\n结论：" + verdict,
    "color:#0369a1;font-size:12px;");
  return out;
}
window.__cbDiag = function () { return cbDiag(true); };
_appPromise.then(function () {
  // 等匿名/邮箱登录态稳定后自动打印一次角色（只读，不做写探测）
  setTimeout(function () { cbDiag(false).catch(function () {}); }, 5000);
});

// CloudBase 异常 → Supabase 风格 error 对象
function mapError(e) {
  if (!e) return null;
  if (typeof e === "string") return { message: e, code: "" };
  // message 可能是对象（v3 SDK），尝试提取可读文本
  var msg = e.message || e.errorMessage || e.error_description || "";
  if (msg && typeof msg === "object") {
    try { msg = JSON.stringify(msg); } catch (err) { msg = String(msg); }
  }
  if (!msg) msg = e.error || e.errMsg || String(e);
  return {
    message: msg,
    code: e.code || e.errorCode || e.errCode || e.error_code || "",
  };
}

/* ---------- 工具：行 ID 生成 + rdb 错误归一 ---------- */
function genRowId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) {}
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

// rdb 返回 { data, error } → 统一转 Error（无错误返回 null）
function rdbErr(res) {
  var e = res && res.error;
  if (!e) return null;
  var msg = e.message || e.error_description || e.details || "";
  if (msg && typeof msg === "object") {
    try { msg = JSON.stringify(msg); } catch (_) { msg = String(msg); }
  }
  if (!msg) { try { msg = JSON.stringify(e); } catch (_) { msg = String(e); } }
  var err = new Error(msg);
  err.code = e.code || e.errorCode || "";
  return err;
}

/* ---------- 数据库查询构建器（Supabase 风格 → CloudBase rdb/PostgreSQL） ----------
 * 当前环境为 PostgreSQL 实例（无文档型数据库），业务行统一存储为：
 *   { id: text 主键, data: jsonb 业务字段 }
 * 读取时自动展开 data 为扁平行（附 id/_id），对业务代码透明。
 * 仅 id 等值过滤走服务端，其余过滤/排序/分页在客户端完成
 * （数据量小，行为与原文档库实现保持一致）。
 */
class TcbQueryBuilder {
  constructor(table, getDb) {
    this._table = table;
    this._getDb = getDb;
    this._selectCols = "*";
    this._wheres = [];       // {op:'eq'|'neq'|'gt'|'lt', f, v}
    this._order = null;      // {f, asc}
    this._limitVal = null;
    this._insertVal = undefined;
    this._updateVal = undefined;
    this._upsertVal = undefined;
    this._onConflict = null;
    this._isDelete = false;
  }

  select(cols) { this._selectCols = cols || "*"; return this; }
  eq(f, v) { this._wheres.push({ op: "eq", f: f, v: v }); return this; }
  neq(f, v) { this._wheres.push({ op: "neq", f: f, v: v }); return this; }
  gt(f, v) { this._wheres.push({ op: "gt", f: f, v: v }); return this; }
  lt(f, v) { this._wheres.push({ op: "lt", f: f, v: v }); return this; }
  order(f, opts) {
    this._order = { f: f, asc: !(opts && opts.ascending === false) };
    return this;
  }
  limit(n) { this._limitVal = n; return this; }
  insert(data) { this._insertVal = data; return this; }
  update(data) { this._updateVal = data; return this; }
  upsert(data, opts) {
    this._upsertVal = data;
    this._onConflict = (opts && opts.onConflict) || null;
    return this;
  }
  upsertOnDocKey() { /* 兼容占位 */ return this; }
  delete() { this._isDelete = true; return this; }

  // Supabase builder 是 thenable —— 支持 await q 直接执行
  then(onOk, onErr) { return this._execute().then(onOk, onErr); }
  catch(fn) { return this._execute().catch(fn); }
  finally(fn) { return this._execute().then(
    function (r) { return Promise.resolve(fn()).then(function () { return r; }); },
    function (e) { return Promise.resolve(fn()).then(function () { throw e; }); }
  ); }

  // 展开存储行 {id, data} → 业务扁平行
  _expand(r) {
    var d = (r && typeof r.data === "object" && r.data !== null && !Array.isArray(r.data)) ? r.data : {};
    var row = Object.assign({}, d);
    if (r && r.id !== undefined && r.id !== null) {
      row.id = r.id;
      row._id = r.id;
    } else if (row.id !== undefined) {
      row._id = row.id;
    }
    return row;
  }

  // 客户端 where 匹配
  _matchRow(row) {
    for (var i = 0; i < this._wheres.length; i++) {
      var c = this._wheres[i];
      var v = row ? row[c.f] : undefined;
      var eqv = (v === c.v) || (String(v) === String(c.v));
      if (c.op === "eq" && !eqv) return false;
      if (c.op === "neq" && eqv) return false;
      if (c.op === "gt" && !(v > c.v)) return false;
      if (c.op === "lt" && !(v < c.v)) return false;
    }
    return true;
  }

  // 拉取匹配行（id 等值过滤走服务端，其余客户端过滤）
  async _fetchRows(db) {
    var idCond = null, otherConds = 0;
    for (var i = 0; i < this._wheres.length; i++) {
      var c = this._wheres[i];
      if (c.op === "eq" && c.f === "id" && idCond === null) idCond = c.v;
      else otherConds++;
    }

    var stored = [];
    if (idCond !== null && otherConds === 0) {
      var g = await db.from(this._table).select("*").eq("id", String(idCond));
      var errG = rdbErr(g);
      if (errG) throw errG;
      stored = (g && g.data) || [];
    } else {
      var PAGE = 1000, MAX_ROWS = 5000, skip = 0;
      while (true) {
        var page = await db.from(this._table).select("*").range(skip, skip + PAGE - 1);
        var errP = rdbErr(page);
        if (errP) throw errP;
        var docs = (page && page.data) || [];
        stored = stored.concat(docs);
        if (docs.length < PAGE) break;
        skip += docs.length;
        if (stored.length >= MAX_ROWS) break;
      }
    }

    var rows = stored.map(this._expand.bind(this));
    return rows.filter(function (row) { return this._matchRow(row); }.bind(this));
  }

  async _execute() {
    try {
      var app = await this._getDb();
      if (!app || typeof app.rdb !== "function") {
        return { data: null, error: mapError("CloudBase rdb(PG) 未就绪，请检查 js/cloudbase.js 配置与网络") };
      }
      var db = app.rdb();

      /* ---- INSERT ---- */
      if (this._insertVal !== undefined) {
        var rows = Array.isArray(this._insertVal) ? this._insertVal : [this._insertVal];
        var out = [];
        for (var i = 0; i < rows.length; i++) {
          var row = JSON.parse(JSON.stringify(rows[i] || {}));
          var newId = (row.id !== undefined && row.id !== null && row.id !== "") ? String(row.id) : genRowId();
          row.id = newId;
          var insRes = await db.from(this._table).insert({ id: newId, data: row });
          var errI = rdbErr(insRes);
          if (errI) throw errI;
          var outRow = Object.assign({}, row);
          outRow._id = newId;
          out.push(outRow);
        }
        return { data: out, error: null };
      }

      /* ---- UPSERT（onConflict 字段 → 用该字段值作为主键 id） ---- */
      if (this._upsertVal !== undefined) {
        var rowsU = Array.isArray(this._upsertVal) ? this._upsertVal : [this._upsertVal];
        var outU = [];
        for (var j = 0; j < rowsU.length; j++) {
          var rowU = JSON.parse(JSON.stringify(rowsU[j] || {}));
          var conflictVal = this._onConflict ? rowU[this._onConflict] : null;
          var docId = (conflictVal !== null && conflictVal !== undefined && conflictVal !== "")
            ? String(conflictVal)
            : ((rowU.id !== undefined && rowU.id !== null && rowU.id !== "") ? String(rowU.id) : genRowId());
          rowU.id = docId;
          var ex = await db.from(this._table).select("id").eq("id", docId);
          var errE = rdbErr(ex);
          if (errE) throw errE;
          if (ex && ex.data && ex.data.length > 0) {
            var upRes = await db.from(this._table).update({ data: rowU }).eq("id", docId);
            var errU2 = rdbErr(upRes);
            if (errU2) throw errU2;
          } else {
            var addRes = await db.from(this._table).insert({ id: docId, data: rowU });
            var errA = rdbErr(addRes);
            if (errA) throw errA;
          }
          rowU._id = docId;
          outU.push(rowU);
        }
        return { data: outU, error: null };
      }

      /* ---- UPDATE ---- */
      if (this._updateVal !== undefined) {
        var updData = JSON.parse(JSON.stringify(this._updateVal));
        var matchedU = await this._fetchRows(db);
        var outUpd = [];
        for (var k = 0; k < matchedU.length; k++) {
          var cur = matchedU[k];
          var merged = Object.assign({}, cur, updData);
          delete merged._id;
          merged.id = cur.id; // 主键列不变
          var uRes = await db.from(this._table).update({ data: merged }).eq("id", cur.id);
          var errU = rdbErr(uRes);
          if (errU) throw errU;
          var uRow = Object.assign({}, merged);
          uRow._id = cur.id;
          outUpd.push(uRow);
        }
        return { data: outUpd, error: null };
      }

      /* ---- DELETE ---- */
      if (this._isDelete) {
        var matchedD = await this._fetchRows(db);
        for (var d = 0; d < matchedD.length; d++) {
          var dRes = await db.from(this._table).delete().eq("id", matchedD[d].id);
          var errD = rdbErr(dRes);
          if (errD) throw errD;
        }
        return { data: [], error: null };
      }

      /* ---- SELECT（默认） ---- */
      var all = await this._fetchRows(db);
      // 客户端排序
      if (this._order) {
        var fOrd = this._order.f, asc = this._order.asc;
        all = all.slice().sort(function (a, b) {
          var av = a[fOrd], bv = b[fOrd];
          if (av === bv) return 0;
          if (av === undefined || av === null) return 1;
          if (bv === undefined || bv === null) return -1;
          if (typeof av === "string" || typeof bv === "string") {
            return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
          }
          return asc ? (av > bv ? 1 : -1) : (av > bv ? -1 : 1);
        });
      }
      if (this._limitVal != null) all = all.slice(0, this._limitVal);
      return { data: all, error: null };
    } catch (e) {
      return { data: null, error: mapError(e) };
    }
  }
}

/* ---------- Storage 兼容层 ---------- */
// 将 CloudBase SDK 的 list 返回值归一化为 Supabase 风格数组 [{name, type:'folder'|'file'}]
// 兼容多种返回结构：
//   Array / {files:[]} / {data:{files:[]}} / {data:[]} / {Contents:[]}
//   新版桶 API：{objects:[]|contents:[], prefixes:[]|commonPrefixes:[]}
function normalizeStorageList(raw, prefix) {
  var files = null, folders = null;
  if (Array.isArray(raw)) files = raw;
  else if (raw) {
    var d = raw.data && typeof raw.data === "object" && !Array.isArray(raw.data) ? raw.data : raw;
    files = raw.files || d.files || d.objects || d.Objects || d.contents || d.Contents || (Array.isArray(raw.data) ? raw.data : null);
    folders = raw.folders || d.folders || d.prefixes || d.commonPrefixes || d.CommonPrefixes || null;
  }
  var out = [], seen = {};
  function pushName(rawName, isDir, it) {
    var key = String(rawName == null ? "" : rawName);
    if (!key) return;
    var name = key.replace(/^\//, "").replace(/\/+$/, "");
    if (pre && name.indexOf(pre) === 0) name = name.slice(pre.length);
    name = name.replace(/^\//, "");
    var slashIdx = name.indexOf("/");
    if (slashIdx >= 0) { name = name.slice(0, slashIdx); isDir = true; }
    if (!name || seen[name]) return;
    seen[name] = true;
    var size = Number((it && (it.size || it.Size || it.contentLength || it.ContentLength)) ||
      (it && it.metadata && it.metadata.size) || 0) || 0;
    var lastModified = (it && (it.lastModified || it.LastModified || it.last_modified || it.updateTime)) || "";
    out.push({
      name: name,
      type: isDir ? "folder" : "file",
      id: (it && (it.id || it.ETag || it.etag)) || name,
      size: size,
      lastModified: lastModified,
      metadata: size ? { size: size } : (it && it.metadata) || null,
      raw: it || { name: key },
    });
  }
  var pre = prefix || "";
  if (Array.isArray(folders)) {
    for (var fi = 0; fi < folders.length; fi++) {
      var fo = folders[fi];
      pushName(typeof fo === "string" ? fo : (fo && (fo.name || fo.prefix || fo.Prefix || fo.path)), true, typeof fo === "string" ? {} : fo);
    }
  }
  if (Array.isArray(files)) {
    for (var i = 0; i < files.length; i++) {
      var it = files[i] || {};
      var key = it.Key || it.key || it.name || it.Name || it.fileName || it.fileID || it.FileID || it.objectId || "";
      var isDir = it.type === "folder" || it.IsDir === true || it.isdir === true || /\/$/.test(String(key));
      pushName(key, isDir, it);
    }
  }
  return out;
}

/* ---------- 默认存储桶解析（PG 模式） ----------
 * PG 模式环境中 Bucket 是 storage.buckets 表中的记录，必须先在控制台/SQL 创建。
 * 业务桶名固定为 STORAGE_BUCKET（'app-photos'）；listBuckets 优先选取同名桶，
 * 其次选取 default 标记桶，最后取第一个。
 * 可用 window.CLOUDBASE_BUCKET 手动覆盖。
 */
var _defaultBucketPromise = null;

// 在任意层级的响应体中深度查找「桶数组」：元素为对象且含 id/bucketId/name 字段
function _deepFindBucketArray(node, depth) {
  if (depth > 6 || node == null) return null;
  if (Array.isArray(node)) {
    if (node.length && node.every(function (x) {
      return x && typeof x === "object" && (x.id || x.bucketId || x.bucket_id || x.name);
    })) return node;
    for (var i = 0; i < node.length; i++) {
      var hit = _deepFindBucketArray(node[i], depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node === "object") {
    var keys = Object.keys(node);
    for (var k = 0; k < keys.length; k++) {
      var hit2 = _deepFindBucketArray(node[keys[k]], depth + 1);
      if (hit2) return hit2;
    }
  }
  return null;
}

function _bucketRowId(b) {
  return (b && (b.id || b.bucketId || b.bucket_id || b.name)) || "";
}

function resolveDefaultBucketId(st) {
  if (window.CLOUDBASE_BUCKET) return Promise.resolve(window.CLOUDBASE_BUCKET);
  if (_defaultBucketPromise) return _defaultBucketPromise;
  _defaultBucketPromise = (async function () {
    if (!st || typeof st.listBuckets !== "function") throw new Error("SDK 不支持 listBuckets");
    var res = await st.listBuckets({ limit: 100 });
    if (res && res.error) throw res.error;
    var body = res && res.data;
    var rows = _deepFindBucketArray(body, 0);
    if (!rows || !rows.length) {
      throw new Error("NO_BUCKET");
    }
    // 1) 优先业务桶名 app-photos；2) default 标记；3) 第一个
    var pick = null;
    for (var i = 0; i < rows.length; i++) {
      if (_bucketRowId(rows[i]) === STORAGE_BUCKET) { pick = rows[i]; break; }
    }
    if (!pick) {
      for (var j = 0; j < rows.length; j++) {
        var b = rows[j] || {};
        if (b.isDefault === true || b.default === true || b.is_default === true || b.type === "default") { pick = b; break; }
      }
    }
    if (!pick) pick = rows[0];
    var id = _bucketRowId(pick);
    if (!id) throw new Error("无法解析默认桶 ID");
    console.log("[cloudbase.js] ✅ 存储桶 ID:", id, "（共", rows.length, "个桶）");
    return id;
  })().catch(function (e) {
    // 失败后允许后续重试（不缓存 rejection）
    _defaultBucketPromise = null;
    throw e;
  });
  return _defaultBucketPromise;
}

/* 经典网关存储适配器：
 * 当环境无法解析新版桶 ID 时，走 SDK 内部 CloudbaseStorage 实体方法
 * （storage.uploadFile / batchGetDownloadUrl / batchDeleteFile），
 * 这些网关接口接受纯 cloudPath（环境即默认桶），不依赖桶 ID。
 * 注意：网关无「列目录」接口，list 仍需 tcb-file-list 云函数。
 */
function makeClassicStorageAdapter() {
  // 上传成功后网关会返回真实 fileID（cloud:// 形式）；缓存 path→fileID，
  // 后续签名/删除优先使用 fileID，纯路径作为回退
  var FILEID_MAP_KEY = "_cbClassicFileIds";
  function loadMap() {
    try { return JSON.parse(localStorage.getItem(FILEID_MAP_KEY) || "{}") || {}; }
    catch (_e) { return {}; }
  }
  function saveMap(m) {
    try { localStorage.setItem(FILEID_MAP_KEY, JSON.stringify(m)); } catch (_e) {}
  }
  function rememberFileId(path, id) {
    if (!id || !path || id === path || String(id).indexOf("://") < 0) return;
    var m = loadMap(); m[path] = id; saveMap(m);
  }
  function idFor(path) {
    var m = loadMap();
    return m[path] || path;
  }
  function forgetIds(pathsArr) {
    var m = loadMap(); var changed = false;
    pathsArr.forEach(function (p) { if (m[p]) { delete m[p]; changed = true; } });
    if (changed) saveMap(m);
  }

  async function classicRef() {
    var app = await getApp();
    if (!app || !app.storage || typeof app.storage.from !== "function") {
      throw new Error("CloudBase Storage 未初始化");
    }
    var ref = app.storage.from(); // 空参 → ClassicStorageFileApi
    if (!ref || !ref.storage) throw new Error("经典存储 API 不可用");
    return ref;
  }
  return {
    __classic: true,
    async upload(path, fileBody, fileOptions) {
      try {
        var ref = await classicRef();
        var res = await ref.upload(path, fileBody, fileOptions || {});
        if (res && !res.error && res.data) rememberFileId(path, res.data.id);
        return res;
      } catch (e) { return { data: null, error: mapError(e) }; }
    },
    async list() {
      return { data: null, error: mapError({ message: "LIST_UNSUPPORTED_CLASSIC", code: "LIST_UNSUPPORTED_CLASSIC" }) };
    },
    async createSignedUrl(path, expiresIn) {
      try {
        var ref = await classicRef();
        var r = await ref.storage.getTempFileURL({
          fileList: [{ fileID: idFor(path), maxAge: expiresIn || 7200 }],
        });
        var item = r && r.fileList && r.fileList[0];
        if (!item || (item.code && item.code !== "SUCCESS")) {
          // 用真实 fileID 失败时再用纯路径兜底重试一次
          if (idFor(path) !== path) {
            var r2 = await ref.storage.getTempFileURL({
              fileList: [{ fileID: path, maxAge: expiresIn || 7200 }],
            });
            item = r2 && r2.fileList && r2.fileList[0];
          }
        }
        if (!item || (item.code && item.code !== "SUCCESS")) {
          return { data: null, error: mapError((item && (item.message || item.code)) || "获取下载链接失败") };
        }
        var url = item.tempFileURL || item.temp_file_url || item.download_url ||
          item.downloadUrl || item.url || "";
        if (!url) return { data: null, error: mapError("getTempFileURL 未返回 URL") };
        return { data: { signedUrl: url }, error: null };
      } catch (e) { return { data: null, error: mapError(e) }; }
    },
    async createSignedUrls(paths, expiresIn) {
      var out = [];
      for (var i = 0; i < paths.length; i++) out.push((await this.createSignedUrl(paths[i], expiresIn)).data);
      return { data: out, error: null };
    },
    async remove(pathsArr) {
      try {
        var ref = await classicRef();
        var arr = (Array.isArray(pathsArr) ? pathsArr : [pathsArr]).map(idFor);
        var r = await ref.storage.deleteFile({ fileList: arr });
        var list = (r && r.fileList) || [];
        var failed = list.filter(function (x) { return x && x.code && x.code !== "SUCCESS"; });
        if (failed.length) {
          return { data: null, error: mapError(failed[0].message || ("删除失败 " + failed.length + " 个文件")) };
        }
        forgetIds(Array.isArray(pathsArr) ? pathsArr : [pathsArr]);
        return { data: list, error: null };
      } catch (e) { return { data: null, error: mapError(e) }; }
    },
    async getPublicUrl(path) { return this.createSignedUrl(path, 3600); },
    async download() {
      return { data: null, error: mapError("经典适配器不支持直接 download，请使用 createSignedUrl + fetch") };
    },
  };
}

function makeStorageRef(bucketName) {
  // PG 桶 API 的对象名不允许前导 "/"（经典 API 会自动剥离，新版不会），统一在边界归一化
  function normKey(p) { return String(p == null ? "" : p).replace(/^\/+/, ""); }
  async function getFromRef() {
    var app = await getApp();
    if (!app || !app.storage) throw new Error("CloudBase Storage 未初始化");
    var st = app.storage;
    if (typeof st.from === "function") {
      // CloudBase 环境只有一个默认桶；忽略 Supabase 时代的桶名（'app-photos'），
      // 动态解析真实桶 ID，否则上传 404、签名/删除报 bucketId is not set
      try {
        var realBucketId = await resolveDefaultBucketId(st);
        return st.from(realBucketId);
      } catch (e) {
        var msg = e && e.message ? e.message : String(e);
        if (msg === "NO_BUCKET") {
          console.warn("[cloudbase.js] ⚠️ PG 存储桶不存在：请先在控制台 SQL 窗口执行 cloudbase-pg-setup.sql 第 7 节创建桶 '" +
            STORAGE_BUCKET + "' 及 RLS 策略（存储→SQL 或数据库→SQL 编辑器）");
          var adapter = makeClassicStorageAdapter();
          adapter.__noBucket = true;
          return adapter;
        } else {
          console.warn("[cloudbase.js] 解析存储桶失败，回退经典网关存储 API:", msg);
        }
        return makeClassicStorageAdapter();
      }
    }
    return st;
  }

  return {
    // 上传文件
    async upload(path, fileBody, fileOptions) {
      try {
        var ref = await getFromRef();
        var res = await ref.upload(normKey(path), fileBody, fileOptions);
        if (res && res.error) return { data: null, error: mapError(res.error) };
        var d = (res && res.data) || {};
        return {
          data: {
            path: d.path || d.fullPath || path,
            fullPath: d.fullPath || d.path || path,
            id: d.id || d.fileID || d.fileId || path,
          },
          error: null,
        };
      } catch (e) {
        return { data: null, error: mapError(e) };
      }
    },

    // 列目录：PG 桶 API（storage.from(bucketId).list）。桶不存在时直接给建桶指引，不打云函数
    async list(prefix, options) {
      var sdkErr = null;
      try {
        var ref = await getFromRef();
        if (ref && ref.__noBucket) {
          return {
            data: null,
            error: mapError({
              code: "TCB_FUNCTION_NOT_FOUND",
              message: "PG 存储桶 '" + STORAGE_BUCKET + "' 不存在，请先执行 cloudbase-pg-setup.sql 第 7 节创建 Bucket 与 RLS 策略。",
            }),
          };
        }
        if (ref && typeof ref.list === "function") {
          // SDK 签名为 list(prefix: string, options)：首参必须是字符串 prefix
          var lr = await ref.list(String(prefix || ""), options || {});
          if (lr && !lr.error) return { data: normalizeStorageList(lr, prefix || ""), error: null };
          sdkErr = (lr && lr.error) || mapError("SDK list 失败");
          console.warn("[cloudbase.js] SDK list 失败，回退云函数 " + FILE_LIST_FUNCTION + ":",
            sdkErr && sdkErr.message ? sdkErr.message : sdkErr);
        }
      } catch (e) {
        sdkErr = mapError(e);
        console.warn("[cloudbase.js] SDK list 异常，回退云函数 " + FILE_LIST_FUNCTION + ":",
          sdkErr && sdkErr.message ? sdkErr.message : sdkErr);
      }
      // 云函数兜底（传统模式环境可选部署 tcb-file-list；PG 模式不需要）
      try {
        var app = await getApp();
        var fnRes = await app.callFunction({
          name: FILE_LIST_FUNCTION,
          data: { bucket: bucketName || "", prefix: prefix || "", limit: (options && options.limit) || 1000 },
        });
        var payload = (fnRes && (fnRes.result || fnRes.data)) || {};
        if (payload.error) return { data: null, error: mapError(payload.error) };
        return { data: payload.data || [], error: null };
      } catch (fe) {
        var fnMsg = (fe && (fe.message || fe.errMsg)) || String(fe);
        // 云函数未部署（404 / FunctionName 找不到）：PG 模式下通常意味着 Bucket 未创建
        if (/404|not.?found|找不到|未部署|FunctionNotFound/i.test(fnMsg)) {
          return {
            data: null,
            error: mapError({
              code: "TCB_FUNCTION_NOT_FOUND",
              message: "文件列表不可用：PG 模式请先执行 cloudbase-pg-setup.sql 第 7 节创建存储桶 '" +
                STORAGE_BUCKET + "' 及 RLS 策略；传统模式需部署云函数 " + FILE_LIST_FUNCTION + "。",
            }),
          };
        }
        // 云函数也失败时优先回报 SDK 的错误（信息更贴近真实根因）
        return { data: null, error: sdkErr || mapError(fe) };
      }
    },

    // 创建签名临时访问 URL
    async createSignedUrl(path, expiresIn) {
      try {
        var ref = await getFromRef();
        var sr = await ref.createSignedUrl(normKey(path), expiresIn || 7200);
        if (sr && sr.error) return { data: null, error: mapError(sr.error) };
        var sd = (sr && sr.data) || {};
        // 经典 API 返回 signedUrl；新版桶 API 返回 fullSignedURL/signedURL
        var signedUrl = sd.signedUrl || sd.signedURL || sd.fullSignedURL || sd.fullSignedUrl || sd.url ||
          (Array.isArray(sd) && sd[0] && (sd[0].signedUrl || sd[0].fullSignedURL || sd[0].url)) || null;
        if (!signedUrl) return { data: null, error: mapError("createSignedUrl 未返回 URL") };
        return { data: { signedUrl: signedUrl }, error: null };
      } catch (e) {
        return { data: null, error: mapError(e) };
      }
    },

    // 批量签名
    async createSignedUrls(paths, expiresIn) {
      var out = [];
      for (var i = 0; i < paths.length; i++) {
        var r = await this.createSignedUrl(paths[i], expiresIn);
        out.push(r.data);
      }
      return { data: out, error: null };
    },

    // 删除文件
    async remove(paths) {
      try {
        var ref = await getFromRef();
        var rr = await ref.remove((Array.isArray(paths) ? paths : [paths]).map(normKey));
        if (rr && rr.error) return { data: null, error: mapError(rr.error) };
        return { data: (rr && rr.data) || [], error: null };
      } catch (e) {
        return { data: null, error: mapError(e) };
      }
    },

    // 公开访问 URL（私有桶请使用 createSignedUrl）
    async getPublicUrl(path) {
      try {
        var ref = await getFromRef();
        if (typeof ref.getPublicUrl === "function") {
          var pr = await ref.getPublicUrl(normKey(path));
          var pd = (pr && pr.data) || {};
          return { data: { publicUrl: pd.publicUrl || pd.url || path }, error: null };
        }
        return { data: { publicUrl: path }, error: null };
      } catch (e) {
        return { data: null, error: mapError(e) };
      }
    },

    // 下载文件（返回 Blob）
    async download(path) {
      try {
        var ref = await getFromRef();
        var dr = await ref.download(normKey(path));
        if (dr && dr.error) return { data: null, error: mapError(dr.error) };
        return { data: (dr && dr.data) || dr || null, error: null };
      } catch (e) {
        return { data: null, error: mapError(e) };
      }
    },
  };
}

/* ---------- 对外暴露的 Supabase 兼容客户端 ---------- */
export const supabase = {
  // 标记：这是 CloudBase 兼容层（诊断用）
  __isCloudBaseCompat: true,

  auth: {
    // 用户名/邮箱密码登录
    // 兼容层：业务代码传 { email/username, password }
    // v3.9.3 原生 auth.signInWithPassword 返回 { data: {user, session}, error }
    async signInWithPassword(credentials) {
      try {
        var app = await getApp();
        var auth = getAuthInstance(app);
        if (!auth) {
          return { data: { user: null, session: null }, error: mapError("CloudBase 登录模块未就绪") };
        }
        var creds = Object.assign({}, credentials);
        // email 与 username 均可，优先用用户实际填写的字段
        if (!creds.username && creds.email) creds.username = creds.email;
        delete creds.email;

        // 先清掉任何已有会话（尤其是 ensureLogin 留下的匿名会话），
        // 否则 SDK 可能复用旧会话，导致邮箱登录后 JWT 仍是 role=anon
        try {
          if (typeof auth.signOut === "function") {
            await auth.signOut();
          }
        } catch (_e) { /* 忽略 signOut 失败，继续登录 */ }
        clearSessionCache();

        var res;
        if (typeof auth.signInWithPassword === "function") {
          // v3.9.3 官方账号密码登录方法（登录失败 5 次后若触发验证码，SDK 经 adapter 弹窗）
          res = await auth.signInWithPassword({
            username: creds.username,
            password: creds.password,
          });
        } else {
          return { data: { user: null, session: null }, error: mapError("CloudBase 登录模块未就绪") };
        }
        if (!res || res.error) {
          var errObj = (res && res.error) || mapError("登录失败");
          return { data: { user: null, session: null }, error: mapError(errObj) };
        }
        // 成功：data.user / data.session
        var rawUser = (res.data && res.data.user) || null;
        console.log("[cloudbase.js] signInWithPassword 原始返回 user:",
          rawUser ? { id: rawUser.userId || rawUser.uid || rawUser.id, email: rawUser.email || "", username: rawUser.username || "" } : null);
        var user = rawUser ? mapUser(rawUser) : await fetchUser(app);
        if (!user) user = await fetchUser(app);
        console.log("[cloudbase.js] 登录后映射用户 email=" + (user && user.email) + " is_anonymous=" + (user && user.is_anonymous));
        if (user) saveSessionCache(user);
        return {
          data: { user: user, session: (res.data && res.data.session) || null },
          error: null,
        };
      } catch (e) {
        return { data: { user: null, session: null }, error: mapError(e) };
      }
    },

    // 获取当前登录用户（服务端校验）
    async getUser() {
      try {
        var app = await getApp();
        if (!app) return { data: { user: null }, error: mapError("CloudBase SDK 未初始化") };
        var user = await fetchUser(app);
        if (!user) {
          return { data: { user: null }, error: mapError("未登录或会话已失效") };
        }
        saveSessionCache(user);
        return { data: { user: user }, error: null };
      } catch (e) {
        return { data: { user: null }, error: mapError(e) };
      }
    },

    // 获取当前会话（同步语义：优先读缓存，再异步校验）
    async getSession() {
      try {
        var cached = readSessionCache();
        var app = await getApp();
        var token = app ? await fetchAccessToken(app) : null;
        var user = cached ? cached.user : null;
        // 有 SDK 能力时后台刷新用户（失败不阻塞）
        if (app && typeof app.auth !== "undefined") {
          var fresh = await fetchUser(app);
          if (fresh) {
            user = fresh;
            saveSessionCache(fresh);
          }
        }
        if (!user) return { data: { session: null }, error: null };
        return { data: { session: { access_token: token, user: user } }, error: null };
      } catch (e) {
        return { data: { session: null }, error: mapError(e) };
      }
    },

    // 退出登录
    async signOut() {
      try {
        var app = await getApp();
        var auth = getAuthInstance(app);
        if (auth && typeof auth.signOut === "function") {
          await auth.signOut();
        }
        clearSessionCache();
        return { error: null };
      } catch (e) {
        clearSessionCache();
        return { error: mapError(e) };
      }
    },

    // 刷新用户信息
    async refreshUser() {
      var app = await getApp();
      var user = app ? await fetchUser(app) : null;
      if (user) saveSessionCache(user);
      return { data: { user: user }, error: user ? null : mapError("未登录") };
    },

    // 匿名登录（需控制台开启）
    async signInAnonymously() {
      try {
        var app = await getApp();
        var auth = getAuthInstance(app);
        if (!auth) {
          return { data: null, error: mapError("匿名登录不可用") };
        }
        // v3: anonymousAuthProvider().signIn()；v2: signInAnonymously()
        var anonProvider = (typeof auth.anonymousAuthProvider === "function")
          ? auth.anonymousAuthProvider()
          : null;
        if (anonProvider && typeof anonProvider.signIn === "function") {
          await anonProvider.signIn();
        } else if (typeof auth.signInAnonymously === "function") {
          await auth.signInAnonymously();
        } else {
          return { data: null, error: mapError("当前 SDK 不支持匿名登录") };
        }
        return { data: null, error: null };
      } catch (e) {
        return { data: null, error: mapError(e) };
      }
    },
  },

  // 数据库：supabase.from('table').select()/insert()/update()/upsert()/delete()
  from(table) {
    return new TcbQueryBuilder(table, getApp);
  },

  // 存储：supabase.storage.from('bucket').upload()/list()/createSignedUrl()/remove()
  storage: {
    from(bucket) {
      return makeStorageRef(bucket);
    },
  },

  // 云函数调用
  async callFunction(name, data) {
    var app = await getApp();
    if (!app) throw new Error("CloudBase SDK 未初始化");
    return app.callFunction({ name: name, data: data });
  },
};

// ===== 全局暴露（与原 Supabase 部署保持一致的全局契约）=====
// 注意：window.cloudbase 是 SDK 本身的全局名，不要覆盖
window.supabase = supabase;
window.CloudbaseClient = supabase;
window.CLOUDBASE_ENV = CLOUDBASE_ENV;
window.CLOUDBASE_REGION = CLOUDBASE_REGION;
window.STORAGE_BUCKET = STORAGE_BUCKET;
window.AUTH_SESSION_KEY = AUTH_SESSION_KEY;

console.log("[cloudbase.js] ✅ Supabase 兼容层已就绪（底层: CloudBase env=" + CLOUDBASE_ENV + "）");
