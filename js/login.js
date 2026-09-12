/* ===== CloudBase 登录逻辑 login.js =====
 *
 * 使用 supabase 兼容层（js/cloudbase.js）的 auth.signInWithPassword({ email, password })
 * 完成登录（底层为 CloudBase 云开发邮箱密码登录）
 * 不在前端硬编码用户名/密码
 * 登录成功后跳转到 ./index.html
 */

import { supabase, CLOUDBASE_ENV } from "./cloudbase.js?v=20260912g";

// 中文提示文案
const MSG = {
  empty: "请输入用户名和密码",
  invalidEmail: "请输入用户名",
  submitting: "登录中…",
  success: "登录成功，正在跳转…",
  invalidCreds: "用户名或密码错误",
  notConfirmed: "账号尚未验证，请先去邮箱确认",
  network: "网络错误，请检查网络连接",
  envNotConfigured: "CloudBase 环境 ID 未配置，请联系管理员",
  unknown: "登录失败，请稍后重试",
};

function setMessage(text, type) {
  const el = document.getElementById("login-message");
  if (!el) return;
  el.textContent = text || "";
  el.style.color =
    type === "error"
      ? "#dc2626"
      : type === "success"
      ? "#059669"
      : type === "info"
      ? "#2563eb"
      : "#6b7280";
}

function setDebug(text) {
  const el = document.getElementById("debug-panel");
  if (!el) return;
  el.style.display = text ? "block" : "none";
  el.textContent = text || "";
}

function setButtonState(btn, disabled, label) {
  if (!btn) return;
  btn.disabled = !!disabled;
  if (label !== undefined) btn.textContent = label;
}

// 统一登录入口
async function handleLogin(event) {
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  const emailEl = document.getElementById("email");
  const pwdEl = document.getElementById("password");
  const btn = document.getElementById("loginBtn");

  const email = (emailEl ? emailEl.value : "").trim();
  const password = pwdEl ? pwdEl.value : "";

  // 1) 空值检查
  if (!email || !password) {
    setMessage(MSG.empty, "error");
    return false;
  }

  // 2) 用户名格式校验（允许邮箱或普通用户名）
  if (!/^[^\s@]{2,}$/.test(email)) {
    setMessage(MSG.invalidEmail, "error");
    return false;
  }

  // 3) 配置检查
  if (!CLOUDBASE_ENV || CLOUDBASE_ENV === "your-env-id") {
    setMessage(MSG.envNotConfigured, "error");
    setDebug("CLOUDBASE_ENV 仍是占位符，请在 js/cloudbase.js 中填入真实值");
    return false;
  }

  setButtonState(btn, true, MSG.submitting);
  setMessage("");
  setDebug("");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      console.error("[login] signInWithPassword error:", error);

      // 错误分类（CloudBase 错误信息）
      const em = ((error.message || "") + " " + (error.code || "")).toLowerCase();
      if (em.indexOf("password") >= 0 && (em.indexOf("error") >= 0 || em.indexOf("invalid") >= 0 || em.indexOf("incorrect") >= 0 || em.indexOf("wrong") >= 0)) {
        setMessage(MSG.invalidCreds, "error");
      } else if (em.indexOf("invalid_credentials") >= 0 || em.indexOf("invalid login") >= 0 || em.indexOf("auth error") >= 0 || em.indexOf("账号或密码") >= 0) {
        setMessage(MSG.invalidCreds, "error");
      } else if (em.indexOf("not confirmed") >= 0 || em.indexOf("unverified") >= 0 || em.indexOf("not verified") >= 0) {
        setMessage(MSG.notConfirmed, "error");
      } else if (em.indexOf("user not found") >= 0 || em.indexOf("user_not_found") >= 0 || em.indexOf("not exist") >= 0) {
        setMessage("该用户名在系统中不存在", "error");
      } else if (em.indexOf("rate limit") >= 0 || em.indexOf("too many") >= 0 || em.indexOf("frequent") >= 0 || em.indexOf("频繁") >= 0) {
        setMessage("尝试次数过多，请稍后再试", "error");
      } else if (em.indexOf("fetch") >= 0 || em.indexOf("network") >= 0 || em.indexOf("abort") >= 0 || em.indexOf("cors") >= 0 || em.indexOf("跨域") >= 0) {
        setMessage(MSG.network, "error");
        setDebug("网络请求失败：\n" + (error.message || "") + (error.code ? "\n错误码: " + error.code : "") + "\n\n请检查：\n1. 网络连接是否正常\n2. CloudBase 安全域名是否已添加本站域名（控制台→环境配置→安全配置）\n3. 是否被防火墙拦截");
      } else {
        setMessage(error.message || MSG.unknown, "error");
        setDebug("完整错误信息：\n" + (error.message || String(error)) + (error.code ? "\n错误码: " + error.code : ""));
      }
      setButtonState(btn, false, "登 录");
      return false;
    }

    if (!data || !data.user) {
      setMessage(MSG.invalidCreds, "error");
      setButtonState(btn, false, "登 录");
      return false;
    }

    // 登录成功
    window.currentSupabaseUser = data.user;
    setMessage(MSG.success, "success");
    setDebug("登录成功：" + (data.user.email || ""));

    setTimeout(function () {
      try {
        window.location.replace("index.html");
      } catch (e) {
        try {
          window.location.href = "index.html";
        } catch (e2) {
          document.body.innerHTML =
            '<div style="font-family:sans-serif;padding:40px;text-align:center;">' +
            "<h2>✅ 登录成功</h2>" +
            '<p>自动跳转被拦截，请点击下方链接进入系统：</p>' +
            '<a href="index.html" style="font-size:20px;">→ 进入首页</a></div>';
        }
      }
    }, 400);
    return false;
  } catch (err) {
    console.error("[login] exception:", err);
    const msg =
      err && err.message
        ? err.message.indexOf("Failed to fetch") >= 0 || err.message.toLowerCase().indexOf("network") >= 0
          ? MSG.network
          : err.message
        : MSG.network;
    setMessage(msg, "error");
    setDebug("异常详情：\n" + (err && err.stack ? err.stack : String(err)));
    setButtonState(btn, false, "登 录");
    return false;
  }
}

// 暴露到全局，供 login.html 的 onsubmit 调用
window.handleLogin = handleLogin;

// 如果已经登录（同步检查 CloudBase 会话缓存），立即跳首页
// 先用同步方式读 localStorage，避免异步 getUser() 失败/卡住时停留在登录页
// 关键：匿名会话（无邮箱）不跳，否则会与 auth-guard 的匿名拦截形成登录→首页→登录死循环
(function redirectIfAuthedSync() {
  try {
    var raw = localStorage.getItem("tcb_auth_session");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.user && parsed.user.id && parsed.user.email && !parsed.user.is_anonymous) {
        const go = () => {
          try { window.location.replace("index.html"); }
          catch (e) { window.location.href = "index.html"; }
        };
        go();
        setTimeout(go, 30);
        setTimeout(go, 300);
      }
    }
  } catch (_) {}
})();

// 异步再确认一次（权威 getUser）—— 同样要求有邮箱才跳
(async function redirectIfAuthed() {
  try {
    const { data } = await supabase.auth.getUser();
    if (data && data.user && data.user.email && !data.user.is_anonymous) {
      const go = () => {
        try { window.location.replace("index.html"); }
        catch (e) { window.location.href = "index.html"; }
      };
      go();
      setTimeout(go, 30);
      setTimeout(go, 300);
    }
  } catch (e) {
    // 忽略，停留在登录页
  }
})();
