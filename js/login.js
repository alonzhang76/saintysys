/* ===== Supabase 登录逻辑 login.js =====
 *
 * 使用 supabase.auth.signInWithPassword({ email, password }) 完成登录
 * 不在前端硬编码用户名/密码
 * 登录成功后跳转到 ./index.html
 */

import { supabase, SUPABASE_URL } from "./supabase.js";

// 中文提示文案
const MSG = {
  empty: "请输入邮箱和密码",
  invalidEmail: "请输入正确的邮箱地址",
  submitting: "登录中…",
  success: "登录成功，正在跳转…",
  invalidCreds: "邮箱或密码错误",
  notConfirmed: "邮箱尚未验证，请先去邮箱确认",
  network: "网络错误，请检查网络连接",
  urlNotConfigured: "Supabase URL 未配置，请联系管理员",
  keyNotConfigured: "Supabase Key 未配置，请联系管理员",
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

  // 2) 邮箱格式校验
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setMessage(MSG.invalidEmail, "error");
    return false;
  }

  // 3) 配置检查
  if (!SUPABASE_URL || SUPABASE_URL.indexOf("请替换") >= 0) {
    setMessage(MSG.urlNotConfigured, "error");
    setDebug("SUPABASE_URL 仍是占位符，请在 js/supabase.js 中填入真实值");
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

      // 错误分类
      const em = (error.message || "").toLowerCase();
      if (em.indexOf("invalid login") >= 0 || em.indexOf("invalid_credentials") >= 0) {
        setMessage(MSG.invalidCreds, "error");
      } else if (em.indexOf("email not confirmed") >= 0 || em.indexOf("not confirmed") >= 0) {
        setMessage(MSG.notConfirmed, "error");
      } else if (em.indexOf("email") >= 0 && em.indexOf("not found") >= 0) {
        setMessage("该邮箱在系统中不存在", "error");
      } else if (em.indexOf("rate limit") >= 0 || em.indexOf("too many") >= 0) {
        setMessage("尝试次数过多，请稍后再试", "error");
      } else if (em.indexOf("fetch") >= 0 || em.indexOf("network") >= 0 || em.indexOf("abort") >= 0) {
        setMessage(MSG.network, "error");
        setDebug("网络请求失败：\n" + error.message + "\n\n请检查：\n1. 网络连接是否正常\n2. Supabase URL 是否正确\n3. 是否被防火墙拦截");
      } else {
        setMessage(error.message || MSG.unknown, "error");
        setDebug("完整错误信息：\n" + (error.message || String(error)));
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

// 如果已经登录，直接跳首页
(async function redirectIfAuthed() {
  try {
    const { data } = await supabase.auth.getUser();
    if (data && data.user) {
      window.location.replace("index.html");
    }
  } catch (e) {
    // 忽略，停留在登录页
  }
})();
