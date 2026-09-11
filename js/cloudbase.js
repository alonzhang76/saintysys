/* ===== CloudBase 客户端 + Supabase 兼容层 cloudbase.js =====
 *
 * 本项目已从 Supabase 迁移到腾讯云开发 CloudBase（https://tcb.cloud.tencent.com）
 *
 * 工作原理：
 *   - 通过 CDN 加载 CloudBase JS SDK v2（@cloudbase/js-sdk，UMD 版）
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
export const CLOUDBASE_ENV = "your-env-id";
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
const SDK_VERSION = "2.28.6";
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

/* ---------- 初始化 CloudBase App ---------- */
var _appPromise = loadSdk()
  .then(function (cb) {
    var initOpts = {
      env: CLOUDBASE_ENV,
      region: CLOUDBASE_REGION,
      // v2 SDK 要求显式开启会话检测，保持与旧行为一致
      auth: { detectSessionInUrl: true },
    };
    if (CLOUDBASE_ACCESS_KEY) initOpts.accessKey = CLOUDBASE_ACCESS_KEY;
    var app = cb.init(initOpts);
    console.log("[cloudbase.js] ✅ CloudBase SDK 已初始化 env=" + CLOUDBASE_ENV);
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

// 兼容 v1/v2 差异：v2 中 auth 既是函数也是对象
function getAuthInstance(app) {
  if (!app) return null;
  try {
    return typeof app.auth === "function" ? app.auth() : app.auth;
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
  return {
    id: id,
    sub: id,
    email: email,
    phone: raw.phone || raw.phoneNumber || "",
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
  // 优先 v2 supabase 风格 getUser()
  if (typeof auth.getUser === "function") {
    try {
      var r = await auth.getUser();
      var u = (r && r.user) || (r && r.data && r.data.user) || null;
      if (u) return mapUser(u);
      if (r && r.data && r.data.userId) return mapUser(r.data);
    } catch (e) { /* 继续尝试其他方法 */ }
  }
  // 兜底 getUserInfo()（v1 风格，可能直接返回用户对象）
  if (typeof auth.getUserInfo === "function") {
    try {
      var r2 = await auth.getUserInfo();
      var u2 = (r2 && (r2.userInfo || r2.user)) || r2 || null;
      if (u2 && (u2.userId || u2.uid || u2._id)) return mapUser(u2);
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
  try {
    var auth = getAuthInstance(app);
    if (!auth) return;
    var hasLogin = false;
    if (typeof auth.hasLoginState === "function") {
      try { hasLogin = !!(await auth.hasLoginState()); } catch (e) {}
    }
    if (typeof auth.checkLoginState === "function" && !hasLogin) {
      try {
        var ls = await auth.checkLoginState();
        hasLogin = !!(ls && (ls.loginState || ls));
      } catch (e) {}
    }
    if (hasLogin) return;
    var cached = readSessionCache();
    if (cached && cached.user && cached.user.id) return; // 已有本地会话，等 getUser 校验
    if (typeof auth.signInAnonymously === "function") {
      await auth.signInAnonymously();
      console.log("[cloudbase.js] 已匿名登录（共享数据可读）");
    }
  } catch (e) {
    console.warn("[cloudbase.js] 匿名登录不可用（请在控制台开启匿名登录）:", e && e.message ? e.message : e);
  }
}

// CloudBase 异常 → Supabase 风格 error 对象
function mapError(e) {
  if (!e) return null;
  if (typeof e === "string") return { message: e, code: "" };
  return {
    message: e.message || e.errorMessage || String(e),
    code: e.code || e.errorCode || e.errCode || "",
  };
}

/* ---------- 数据库查询构建器（Supabase 风格 → CloudBase collection） ---------- */
class TcbQueryBuilder {
  constructor(table, getDb) {
    this._table = table;
    this._getDb = getDb;
    this._selectCols = "*";
    this._wheres = [];       // {op:'eq'|'neq', f, v}
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

  // 归一化文档：补 id 字段（来自 _id）
  _norm(doc) {
    if (!doc || typeof doc !== "object") return doc;
    if (doc.id === undefined && doc._id !== undefined) {
      var copy = Object.assign({}, doc);
      copy.id = doc._id;
      return copy;
    }
    return doc;
  }

  // where 条件 → CloudBase where 对象
  _buildWhere(cmd) {
    var w = {};
    for (var i = 0; i < this._wheres.length; i++) {
      var c = this._wheres[i];
      if (c.op === "eq") w[c.f] = c.v;
      else if (c.op === "neq") w[c.f] = cmd.neq(c.v);
      else if (c.op === "gt") w[c.f] = cmd.gt(c.v);
      else if (c.op === "lt") w[c.f] = cmd.lt(c.v);
    }
    return w;
  }

  async _execute() {
    try {
      var app = await this._getDb();
      if (!app || !app.database) {
        return { data: null, error: mapError("CloudBase SDK 未初始化，请检查 js/cloudbase.js 配置与网络") };
      }
      var db = app.database();
      var cmd = db.command;
      var collection = db.collection(this._table);
      var whereObj = this._buildWhere(cmd);

      /* ---- INSERT ---- */
      if (this._insertVal !== undefined) {
        var rows = Array.isArray(this._insertVal) ? this._insertVal : [this._insertVal];
        var out = [];
        for (var i = 0; i < rows.length; i++) {
          var res = await collection.add(JSON.parse(JSON.stringify(rows[i])));
          var row = Object.assign({}, rows[i]);
          row.id = res && res.id ? res.id : row.id;
          row._id = row.id;
          out.push(row);
        }
        return { data: out, error: null };
      }

      /* ---- UPSERT（onConflict 字段 → 用该字段值作为文档 _id，实现原子级 upsert） ---- */
      if (this._upsertVal !== undefined) {
        var rowsU = Array.isArray(this._upsertVal) ? this._upsertVal : [this._upsertVal];
        var outU = [];
        for (var j = 0; j < rowsU.length; j++) {
          var rowU = JSON.parse(JSON.stringify(rowsU[j]));
          var conflictVal = this._onConflict ? rowU[this._onConflict] : null;
          var saved = false;
          if (conflictVal !== null && conflictVal !== undefined && conflictVal !== "") {
            // 方案 A：以冲突字段值为文档 ID，直接 set（不存在则创建）
            try {
              await collection.doc(String(conflictVal)).set(rowU);
              rowU.id = String(conflictVal);
              rowU._id = rowU.id;
              saved = true;
            } catch (eA) {
              // 方案 B：查询已有文档后 update / add
              try {
                var ex = await collection.where(this._onConflict ? { [this._onConflict]: conflictVal } : {}).get();
                var exDocs = (ex && ex.data) || [];
                if (exDocs.length > 0) {
                  await collection.doc(exDocs[0]._id).update(rowU);
                  rowU.id = exDocs[0]._id;
                  rowU._id = rowU.id;
                } else {
                  var addRes = await collection.add(rowU);
                  rowU.id = addRes && addRes.id ? addRes.id : "";
                  rowU._id = rowU.id;
                }
                saved = true;
              } catch (eB) {
                return { data: null, error: mapError(eB.message || eB) };
              }
            }
          }
          if (!saved) {
            // 没有 onConflict：直接新增
            try {
              var addRes2 = await collection.add(rowU);
              rowU.id = addRes2 && addRes2.id ? addRes2.id : "";
              rowU._id = rowU.id;
            } catch (eAdd) {
              return { data: null, error: mapError(eAdd.message || eAdd) };
            }
          }
          outU.push(rowU);
        }
        return { data: outU, error: null };
      }

      /* ---- UPDATE ---- */
      if (this._updateVal !== undefined) {
        var updData = JSON.parse(JSON.stringify(this._updateVal));
        // 按主键 id 等值更新
        var idWhere = null;
        for (var w1 = 0; w1 < this._wheres.length; w1++) {
          if (this._wheres[w1].f === "id" && this._wheres[w1].op === "eq") idWhere = this._wheres[w1].v;
        }
        try {
          if (idWhere) {
            await collection.doc(String(idWhere)).update(updData);
            var got = await collection.doc(String(idWhere)).get();
            var docs1 = ((got && got.data) || []).map(this._norm.bind(this));
            return { data: docs1, error: null };
          }
          await collection.where(whereObj).update(updData);
          var got2 = await collection.where(whereObj).get();
          var docs2 = ((got2 && got2.data) || []).map(this._norm.bind(this));
          return { data: docs2, error: null };
        } catch (eU) {
          return { data: null, error: mapError(eU.message || eU) };
        }
      }

      /* ---- DELETE ---- */
      if (this._isDelete) {
        var delId = null;
        for (var w2 = 0; w2 < this._wheres.length; w2++) {
          if (this._wheres[w2].f === "id" && this._wheres[w2].op === "eq") delId = this._wheres[w2].v;
        }
        try {
          if (delId) {
            await collection.doc(String(delId)).remove();
          } else {
            await collection.where(whereObj).remove();
          }
          return { data: [], error: null };
        } catch (eD) {
          return { data: null, error: mapError(eD.message || eD) };
        }
      }

      /* ---- SELECT（默认） ---- */
      // 按主键 id 查单条
      var selId = null;
      for (var w3 = 0; w3 < this._wheres.length; w3++) {
        if (this._wheres[w3].f === "id" && this._wheres[w3].op === "eq") selId = this._wheres[w3].v;
      }
      if (selId) {
        var g = await collection.doc(String(selId)).get();
        var one = ((g && g.data) || []).map(this._norm.bind(this));
        return { data: one, error: null };
      }

      // 分页拉全量（CloudBase 单次最多 1000 条），再在客户端应用 limit/order
      var PAGE = 1000;
      var MAX_ROWS = 5000;
      var skip = 0;
      var all = [];
      while (true) {
        var q = Object.keys(whereObj).length > 0 ? collection.where(whereObj) : collection;
        if (this._order) q = q.orderBy(this._order.f, this._order.asc ? "asc" : "desc");
        var want = this._limitVal != null ? Math.max(this._limitVal - skip, 0) : PAGE;
        if (want <= 0) break;
        q = q.skip(skip).limit(Math.min(want, PAGE));
        var page = await q.get();
        var docs = (page && page.data) || [];
        all = all.concat(docs);
        if (docs.length < Math.min(want, PAGE)) break;
        skip += docs.length;
        if (all.length >= MAX_ROWS) break;
      }
      // 客户端排序兜底（orderBy 对混合类型字段可能不生效）
      if (this._order && this._limitVal == null) {
        var fOrd = this._order.f;
        all = all.slice().sort(function (a, b) {
          var av = a[fOrd], bv = b[fOrd];
          if (av === bv) return 0;
          if (av === undefined || av === null) return 1;
          if (bv === undefined || bv === null) return -1;
          if (typeof av === "string" || typeof bv === "string") {
            return this._order.asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
          }
          return this._order.asc ? (av > bv ? 1 : -1) : (av > bv ? -1 : 1);
        }.bind(this));
      }
      if (this._limitVal != null) all = all.slice(0, this._limitVal);
      return { data: all.map(this._norm.bind(this)), error: null };
    } catch (e) {
      return { data: null, error: mapError(e) };
    }
  }
}

/* ---------- Storage 兼容层 ---------- */
function makeStorageRef(bucketName) {
  async function getFromRef() {
    var app = await getApp();
    if (!app || !app.storage) throw new Error("CloudBase Storage 未初始化");
    var st = app.storage;
    if (typeof st.from === "function") {
      return bucketName ? st.from(bucketName) : st.from();
    }
    return st;
  }

  return {
    // 上传文件
    async upload(path, fileBody, fileOptions) {
      try {
        var ref = await getFromRef();
        var res = await ref.upload(path, fileBody, fileOptions);
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

    // 列目录：优先 SDK（若支持），否则调 tcb-file-list 云函数
    async list(prefix, options) {
      try {
        var ref = await getFromRef();
        if (ref && typeof ref.list === "function") {
          var lr = await ref.list(prefix || "", options || {});
          if (lr && lr.error) return { data: null, error: mapError(lr.error) };
          return { data: (lr && lr.data) || [], error: null };
        }
        // 云函数兜底（需部署 tcb-file-list）
        var app = await getApp();
        var fnRes = await app.callFunction({
          name: FILE_LIST_FUNCTION,
          data: { bucket: bucketName || "", prefix: prefix || "", limit: (options && options.limit) || 1000 },
        });
        var payload = (fnRes && (fnRes.result || fnRes.data)) || {};
        if (payload.error) return { data: null, error: mapError(payload.error) };
        return { data: payload.data || [], error: null };
      } catch (e) {
        return { data: null, error: mapError(e) };
      }
    },

    // 创建签名临时访问 URL
    async createSignedUrl(path, expiresIn) {
      try {
        var ref = await getFromRef();
        var sr = await ref.createSignedUrl(path, expiresIn || 7200);
        if (sr && sr.error) return { data: null, error: mapError(sr.error) };
        var sd = (sr && sr.data) || {};
        var signedUrl = sd.signedUrl || sd.signedURL || sd.url || (Array.isArray(sd) && sd[0] && (sd[0].signedUrl || sd[0].url)) || null;
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
        var rr = await ref.remove(Array.isArray(paths) ? paths : [paths]);
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
          var pr = await ref.getPublicUrl(path);
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
        var dr = await ref.download(path);
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
    // 邮箱密码登录
    async signInWithPassword(credentials) {
      try {
        var app = await getApp();
        var auth = getAuthInstance(app);
        if (!auth || typeof auth.signInWithPassword !== "function") {
          return { data: { user: null, session: null }, error: mapError("CloudBase 登录模块未就绪") };
        }
        var res;
        try {
          res = await auth.signInWithPassword(credentials);
        } catch (eRaw) {
          return { data: { user: null, session: null }, error: mapError(eRaw) };
        }
        if (res && res.error) {
          return { data: { user: null, session: null }, error: mapError(res.error) };
        }
        // 登录成功后拉取完整用户信息
        var user = await fetchUser(app);
        if (user) saveSessionCache(user);
        return { data: { user: user, session: user ? { access_token: null, user: user } : null }, error: null };
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
        if (!auth || typeof auth.signInAnonymously !== "function") {
          return { data: null, error: mapError("匿名登录不可用") };
        }
        await auth.signInAnonymously();
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
