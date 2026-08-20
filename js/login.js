/* ===== Supabase 登录逻辑 login.js =====
 *
 * 使用 supabase.auth.signInWithPassword({ email, password }) 完成登录
 * 不在前端硬编码用户名/密码
 * 登录成功后跳转到 ./index.html
 *
 * 在 login.html 中以 type="module" 加载：
 *   <script type="module" src="js/login.js"></script>
 *
 * 注意：所有跳转使用相对路径，兼容
 *   https://alonzhang76.github.io/saintysys/login.html
 *   https://www.lori.net.cn/login.html
 */

import { supabase } from "./supabase.js";

// 中文提示文案
const MSG = {
  empty: "请输入邮箱和密码",
  submitting: "登录中…",
  success: "登录成功，正在跳转…",
  invalidCreds: "邮箱或密码错误",
  notConfirmed: "邮箱尚未验证，请先去邮箱确认",
  network: "网络错误，请检查网络连接",
  unknown: "登录失败，请稍后重试",
};

function setMessage(text, type) {
  const el = document.getElementById("login-message");
  if (!el) return;
  el.textContent = text || "";
  // type: '' | 'error' | 'success' | 'info'
  el.style.color =
    type === "error"
      ? "#dc2626"
      : type === "success"
      ? "#059669"
      : type === "info"
      ? "#2563eb"
      : "#6b7280";
}

function setButtonState(btn, disabled, label) {
  if (!btn) return;
  btn.disabled = !!disabled;
  if (label !== undefined) btn.textContent = label;
}

// 统一登录入口（供表单 onsubmit 调用）
async function handleLogin(event) {
  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
  }

  const emailEl = document.getElementById("email");
  const pwdEl = document.getElementById("password");
  const btn = document.getElementById("loginBtn");

  const email = (emailEl ? emailEl.value : "").trim();
  const password = pwdEl ? pwdEl.value : "";

  if (!email || !password) {
    setMessage(MSG.empty, "error");
    return false;
  }

  // 基础邮箱格式校验
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setMessage("请输入正确的邮箱地址", "error");
    return false;
  }

  setButtonState(btn, true, MSG.submitting);
  setMessage("");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("[login] signInWithPassword error:", error);
      // 常见错误码映射
      if (error.message && error.message.toLowerCase().indexOf("invalid login") >= 0) {
        setMessage(MSG.invalidCreds, "error");
      } else if (error.message && error.message.toLowerCase().indexOf("email not confirmed") >= 0) {
        setMessage(MSG.notConfirmed, "error");
      } else {
        setMessage(error.message || MSG.unknown, "error");
      }
      setButtonState(btn, false, "登 录");
      return false;
    }

    if (!data || !data.user) {
      setMessage(MSG.invalidCreds, "error");
      setButtonState(btn, false, "登 录");
      return false;
    }

    window.currentSupabaseUser = data.user;
    setMessage(MSG.success, "success");

    // 跳转首页（相对路径，兼容 GitHub Pages 子路径与 Vercel 根路径）
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
    setButtonState(btn, false, "登 录");
    return false;
  }
}

// 暴露到全局，供 login.html 的 onsubmit="return handleLogin(event)" 调用
// 注意：login.html 的 <form> 已通过 onsubmit 属性绑定 handleLogin，
// 这里不再用 addEventListener 重复绑定，避免重复触发 signInWithPassword
window.handleLogin = handleLogin;

// 如果已经登录，直接跳首页（避免重复登录）
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
