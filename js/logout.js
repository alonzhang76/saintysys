/* ===== 退出登录 logout.js =====
 *
 * 调用 supabase.auth.signOut() 清除会话，然后跳转到 ./login.html
 *
 * 加载方式：
 *   <script type="module" src="js/logout.js"></script>
 *
 * 兼容多种退出按钮 id：
 *   - logout-button
 *   - logout-btn
 *   - logout
 *
 * 注意：auth-guard.js 已经覆盖了 App.logout，所以页面上
 * onclick="App.logout()" 的按钮无需修改即可使用 Supabase 退出。
 * 本文件额外提供对 #logout-button / #logout-btn / #logout 的绑定，
 * 便于以后新增的独立退出按钮使用。
 */

import { supabase } from "./supabase.js";

async function performLogout() {
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.error("[logout] signOut 异常:", e);
  }
  // 清理本地残留登录态（旧的本地系统字段）
  try {
    ["isLoggedIn", "currentUserId", "username", "userRole", "refDPR"].forEach(
      function (k) {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      }
    );
  } catch (e) {}

  try {
    window.location.replace("login.html");
  } catch (e) {
    window.location.href = "login.html";
  }
}

// 暴露到全局，便于 onclick="window.supabaseLogout()" 调用
window.supabaseLogout = performLogout;

// 绑定到常见退出按钮 id
function bindLogoutButtons() {
  const ids = ["logout-button", "logout-btn", "logout"];
  ids.forEach(function (id) {
    const el = document.getElementById(id);
    if (el && !el.dataset.supabaseLogoutBound) {
      el.dataset.supabaseLogoutBound = "1";
      el.addEventListener("click", function (ev) {
        ev.preventDefault();
        performLogout();
      });
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindLogoutButtons);
} else {
  bindLogoutButtons();
}
