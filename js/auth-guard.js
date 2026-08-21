/* ===== 统一登录守卫 auth-guard.js =====
 *
 * 功能：
 *   1. 使用 supabase.auth.getUser() 获取当前登录用户
 *   2. 如果没有登录，跳转到 ./login.html
 *   3. 如果已经登录，允许当前页面继续加载
 *   4. 导出 window.currentSupabaseUser，方便其他页面使用
 *   5. 不把密码保存到 localStorage
 *   6. 不自行伪造登录状态
 *
 * 加载方式：
 *   <script src="js/common.js"></script>
 *   <script src="js/auth-guard.js"></script>   <!-- 经典脚本，放在页面内联脚本之前 -->
 *
 * 工作原理（时序）：
 *   - 本文件是经典脚本（非 module），同步部分会先执行
 *   - 同步部分覆盖 App.checkLogin / App.getCurrentUser /
 *     App.loadUserInfo，使其读取 localStorage 中的 Supabase 会话
 *     （Supabase 客户端本身会把会话写入 localStorage，这不是伪造登录态）
 *   - 异步部分通过动态 import 加载 supabase 客户端，
 *     调用 getUser() 向服务器校验会话有效性
 *   - 若会话无效/过期，清除并跳转登录页
 *   - 同时覆盖 App.logout 调用 supabase.auth.signOut()
 *
 * 这样既能保证页面内联脚本（同步调用 App.checkLogin）正常工作，
 * 又能在后台用 getUser() 做权威校验。
 */

(function () {
  "use strict";

  /* ---------- 同步工具：从 localStorage 读取 Supabase 会话 ----------
   * Supabase v2 客户端默认以 sb-<project-ref>-auth-token 为键名存储会话
   * 这里只读取已存在的会话令牌，不做任何伪造
   */
  function readSupabaseSession() {
    try {
      const keys = Object.keys(localStorage);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        // 兼容 sb-xxx-auth-token 以及带命名空间变体
        if (k && k.indexOf("sb-") === 0 && k.indexOf("-auth-token") >= 0) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            // v2 结构：{ access_token, user, ... }
            if (parsed && parsed.user) return parsed;
          } catch (e) {
            // 某些版本可能存的是字符串，忽略
          }
        }
      }
    } catch (e) {}
    return null;
  }

  // 清理 Supabase 会话存储 + 旧的本地登录态
  function clearAllAuthState() {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(function (k) {
        if (k && k.indexOf("sb-") === 0 && k.indexOf("-auth-token") >= 0) {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {}
    try {
      ["isLoggedIn", "currentUserId", "username", "userRole", "refDPR"].forEach(
        function (k) {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        }
      );
    } catch (e) {}
    // 防残留：清除当前用户缓存，防止 App.getCurrentUser 仍返回旧用户
    try {
      if (window.App) window.App._currentUser = null;
    } catch(e) {}
    window.currentSupabaseUser = null;
  }

  // 把 Supabase user 映射为系统原有的用户结构，保证 App.* 兼容
  function mapSupabaseUser(user) {
    if (!user) return null;
    const email = user.email || "";
    const meta = user.user_metadata || {};
    let role = meta.role || "user";
    const adminEmails = window.ADMIN_EMAILS || [];
    if (adminEmails.indexOf(email) >= 0) {
      role = "admin";
    }
    // 关键修复：从本地 users 列表按邮箱匹配角色（不区分大小写）
    // 设置页面的用户列表（users key）是管理员配置的权威角色来源
    if (adminEmails.indexOf(email) < 0 && window.App) {
      try {
        const localUsers = window.App.store.get("users", []);
        const emailLower = (email || "").toLowerCase().trim();
        if (emailLower) {
          const localUser = localUsers.find((u) => u.email && u.email.toLowerCase().trim() === emailLower);
          if (localUser && localUser.role) {
            role = localUser.role;
            console.log("[auth-guard] 本地用户匹配成功: username=" + localUser.username + ", email=" + localUser.email + ", role=" + role);
          } else {
            console.log("[auth-guard] 本地用户未匹配: email=" + emailLower + ", 本地用户数=" + localUsers.length);
          }
        }
      } catch (e) {
        console.warn("[auth-guard] 读取本地 users 失败:", e);
      }
    }
    return {
      id: user.id,
      username: meta.username || (email ? email.split("@")[0] : "用户"),
      email: email,
      role: role,
      description: meta.description || "",
      status: "active",
      createDate: user.created_at ? String(user.created_at).slice(0, 10) : "",
    };
  }

  /* ---------- 同步覆盖 App 方法 ----------
   * 这些方法在页面内联脚本调用 App.checkLogin() / enforcePagePermission() 时
   * 已经可用，因为本文件是经典脚本，会先于页面底部内联脚本执行
   * 注意：必须与 js/common.js 中的逻辑保持一致，尤其：
   *   - 角色必须按邮箱匹配本地 users 列表（设置页的权威角色来源）
   *   - 显示名必须读本地 users 列表（管理员配置的用户名）
   *   - logout 必须是乐观跳转：先清+跳，signOut 异步，不能被失败阻塞
   */
  function overrideAppSync() {
    if (typeof window.App === "undefined" || !window.App) return;

    // ---- App.checkLogin：同步检查 Supabase 会话，无会话立即跳登录页 ----
    App.checkLogin = function () {
      const session = readSupabaseSession();
      if (!session || !session.user) {
        clearAllAuthState();
        const goLogin = function() {
          try { window.location.replace("login.html"); }
          catch (e) { window.location.href = "login.html"; }
        };
        goLogin();
        setTimeout(goLogin, 30);
        setTimeout(goLogin, 300);
        return false;
      }
      return true;
    };

    // ---- App.getCurrentUser：每次都从最新 users 列表重新映射角色 ----
    App.getCurrentUser = function () {
      const cu = window.currentSupabaseUser
        || ((readSupabaseSession() || {}).user);
      return cu ? mapSupabaseUser(cu) : null;
    };

    // ---- App.loadUserInfo：优先使用本地 users 列表的显示名（管理员在设置页配置的） ----
    App.loadUserInfo = function () {
      let username = "";
      let userEmail = "";
      try {
        const cu = window.currentSupabaseUser
          || ((readSupabaseSession() || {}).user);
        if (cu) {
          userEmail = cu.email || "";
          username = (cu.user_metadata && cu.user_metadata.username) || "";
        }
        // 核心修复：本地 users 列表（管理员权威配置）按邮箱匹配的用户名优先级最高
        if (userEmail && window.App && typeof window.App.store !== "undefined") {
          try {
            const localUsers = window.App.store.get("users", []);
            const emailLower = userEmail.toLowerCase().trim();
            const matched = localUsers.find(function(u) {
              return u.email && u.email.toLowerCase().trim() === emailLower;
            });
            if (matched && matched.username) username = matched.username;
          } catch(e) {}
        }
        if (!username) {
          username = userEmail ? userEmail.split("@")[0] : "用户";
        }
      } catch (e) {}
      const userEl = document.querySelector(".header-user .user-name");
      if (userEl) userEl.textContent = username;
    };

    // ---- App.logout：乐观退出——先清本地+立即跳，signOut 异步 ----
    // 绝对保证"点击退出一定跳登录页"，signOut 网络失败不能阻断跳转
    App.logout = function () {
      clearAllAuthState();
      const goLogin = function() {
        try { window.location.replace("login.html"); }
        catch (e) { window.location.href = "login.html"; }
      };
      goLogin();
      setTimeout(goLogin, 50);
      setTimeout(goLogin, 500);
      // signOut 放跳转之后异步执行，失败静默
      try {
        if (window.supabase && window.supabase.auth && typeof window.supabase.auth.signOut === "function") {
          window.supabase.auth.signOut().catch(function(){});
        } else {
          import("./supabase.js")
            .then(function(mod) { if (mod.supabase) mod.supabase.auth.signOut().catch(function(){}); })
            .catch(function(){});
        }
      } catch(e) {}
    };
  }

  /* ---------- 同步预检：无 Supabase 会话立即跳登录 ----------
   * 对没有 common.js / App 的独立页面（如 shipping documents.html）尤其重要
   * 对有 App 的页面，与 App.checkLogin() 互为冗余双保险，均跳 login.html
   */
  var _preSession = readSupabaseSession();
  if (!_preSession || !_preSession.user) {
    clearAllAuthState();
    // 关键修复：无会话时的跳转也用"乐观多次跳转"
    // 避免 Safari 或 file:/// 协议下 replace 被静默吞掉
    const goLogin = function() {
      try { window.location.replace("login.html"); }
      catch (e) { window.location.href = "login.html"; }
    };
    goLogin();
    setTimeout(goLogin, 20);
    setTimeout(goLogin, 200);
    setTimeout(goLogin, 1500); // 最终兜底
    window.__authGuardRedirected = true;
  } else {
    overrideAppSync();
  }

  /* ---------- 异步守卫：getUser() 权威校验 ----------
   * 动态加载 supabase 模块后向服务器校验会话有效性
   */
  (async function () {
    if (window.__authGuardRedirected) return;
    try {
      const mod = await import("./supabase.js");
      const supabase = mod.supabase;
      // 暴露到全局，方便调试与其他脚本使用
      window.supabase = supabase;

      const { data, error } = await supabase.auth.getUser();

      if (error || !data || !data.user) {
        console.error("[auth-guard] 未登录或会话失效:", error);
        clearAllAuthState();
        const goLogin = function() {
          try { window.location.replace("login.html"); }
          catch (e) { window.location.href = "login.html"; }
        };
        goLogin();
        setTimeout(goLogin, 20);
        setTimeout(goLogin, 200);
        setTimeout(goLogin, 1500);
        return;
      }

      const user = data.user;
      window.currentSupabaseUser = user;

      // 从 Supabase user_roles 表加载用户真实角色
      try {
        const { data: rolesData, error: rolesError } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id);

        // SQL 表中的角色（可能只有自动分配的 'user'）
        const sqlRoles = (!rolesError && rolesData && rolesData.length > 0)
          ? rolesData.map(r => r.role)
          : [];

        // 关键修复：从本地 users 列表按邮箱匹配角色（不区分大小写）
        // 设置页面的用户列表（users key）是管理员配置的权威角色来源
        // 若本地 users 列表尚未从云端同步（空或无匹配），启动重试轮询直到找到匹配或超时
        let localUserRole = null;
        const emailLower = (user.email || '').toLowerCase().trim();
        const tryMatchLocalUser = (doLog) => {
          try {
            if (!window.App || !emailLower) return null;
            const localUsers = window.App.store.get('users', []);
            const localUser = localUsers.find(u => u.email && u.email.toLowerCase().trim() === emailLower);
            if (localUser && localUser.role) {
              if (doLog) console.log('[auth-guard] 异步: 本地用户匹配成功 username=' + localUser.username + ', email=' + localUser.email + ', role=' + localUser.role);
              return localUser.role;
            }
            if (doLog) console.log('[auth-guard] 异步: 本地用户未匹配 email=' + emailLower + ', 本地用户数=' + localUsers.length);
            return null;
          } catch(e) {
            console.warn('[auth-guard] 异步: 读取本地 users 失败:', e);
            return null;
          }
        };
        localUserRole = tryMatchLocalUser(true);

        // 如果第一次没匹配到，启动重试轮询（15秒内每1秒查一次），匹配到就立即刷新权限
        // 解决 users/permissions 从 Supabase 同步晚于 auth-guard 异步守卫导致角色错误的问题
        if (!localUserRole) {
          let retryCount = 0;
          const retryMatch = () => {
            if (retryCount >= 15) return;
            retryCount++;
            const matched = tryMatchLocalUser(false);
            if (matched) {
              console.log('[auth-guard] 重试#' + retryCount + ': 本地用户匹配成功 role=' + matched);
              // 更新角色
              const adminEmails = window.ADMIN_EMAILS || [];
              if (adminEmails.indexOf(user.email || '') < 0) {
                if (window.currentSupabaseUser) {
                  if (!window.currentSupabaseUser.user_metadata) window.currentSupabaseUser.user_metadata = {};
                  window.currentSupabaseUser.user_metadata.role = matched;
                }
                if (window.App && window.App._currentUser) {
                  window.App._currentUser.role = matched;
                }
              }
              // 重新应用页面权限 + 派发事件
              try {
                if (typeof App.enforcePagePermission === 'function' && window._currentPageModule) {
                  App.enforcePagePermission(window._currentPageModule);
                }
                window.dispatchEvent(new CustomEvent('auth-role-updated', {
                  detail: { role: matched, email: user.email, userId: user.id }
                }));
              } catch(e) {}
              return;
            }
            setTimeout(retryMatch, 1000);
          };
          setTimeout(retryMatch, 1000);
        }

        // 合并角色：本地 users 列表角色 + SQL user_roles 角色去重
        const allRoles = [];
        if (localUserRole) allRoles.push(localUserRole);
        sqlRoles.forEach(r => { if (allRoles.indexOf(r) < 0) allRoles.push(r); });
        if (allRoles.length === 0) allRoles.push('user');

        // 角色优先级：admin > manager > 各业务角色 > user
        // 关键修复：不能取 roles[0]，因为 SQL 会给每个用户自动分配 'user' 角色，
        // 导致业务角色（如 merchandiser）被 'user' 覆盖，权限矩阵查到的是 user 的权限（全是 write）
        const ROLE_PRIORITY = ['admin', 'manager', 'merchandiser', 'purchaser', 'designer', 'qc', 'finance', 'documentary', 'user'];
        let finalRole = 'user';
        for (let i = 0; i < ROLE_PRIORITY.length; i++) {
          if (allRoles.indexOf(ROLE_PRIORITY[i]) >= 0) {
            finalRole = ROLE_PRIORITY[i];
            break;
          }
        }

        // 关键修复：将加载的角色写入 window.currentSupabaseUser.user_metadata
        if (window.currentSupabaseUser) {
          if (!window.currentSupabaseUser.user_metadata) {
            window.currentSupabaseUser.user_metadata = {};
          }
          // 管理员邮箱优先（不被 user_roles 表覆盖）
          const adminEmails = window.ADMIN_EMAILS || [];
          if (adminEmails.indexOf(window.currentSupabaseUser.email || '') >= 0) {
            window.currentSupabaseUser.user_metadata.role = 'admin';
          } else {
            window.currentSupabaseUser.user_metadata.role = finalRole;
          }
        }
        // 兼容：也写入 App._currentUser（如果存在）
        if (window.App && window.App._currentUser) {
          window.App._currentUser.role = finalRole;
        }
        console.log('[auth-guard] 用户角色:', finalRole, '| 本地角色:', localUserRole, '| SQL角色:', sqlRoles);

        // 加载用户对各模块的权限
        // 关键修复：只加载 finalRole 对应的权限，不再合并所有角色
        // 旧逻辑合并所有角色并取最高优先级（write > read），导致 'user' 角色的 write 权限
        // 覆盖了业务角色（如 merchandiser）的 read/none 权限，使权限矩阵失效
        // 注意：settings.html 的权限矩阵保存在 localStorage 'permissions' key 中，
        // getPermission() 优先读取 'permissions' key，_userModulePerms 仅作兜底
        try {
          const { data: permsData, error: permsError } = await supabase
            .from('module_permissions')
            .select('module, permission')
            .eq('role', finalRole);

          const merged = {};
          if (!permsError && permsData) {
            permsData.forEach(p => {
              merged[p.module] = p.permission;
            });
            console.log('[auth-guard] 模块权限已加载 (role=' + finalRole + '):', merged);
          } else if (permsError) {
            console.warn('[auth-guard] 加载模块权限失败:', permsError);
          }
          // 无论成功失败都设置 _userModulePerms（即使为空对象），
          // 确保 enforcePagePermission 的 __permWaitPromise 能 resolve，避免页面永远停留在默认权限
          if (window.App) {
            window.App._userModulePerms = merged;
          }
        } catch (e) {
          console.warn('[auth-guard] 加载模块权限失败:', e);
          // 出错时也要设置空对象，让等待的 promise 能 resolve
          if (window.App && !window.App._userModulePerms) {
            window.App._userModulePerms = {};
          }
        }
      } catch (e) {
        console.warn('[auth-guard] 加载角色失败，使用默认角色:', e);
      }

      // 异步覆盖 App.logout 为更完整版本（调用 signOut）
      if (window.App) {
        // 关键修复：乐观退出——先清本地 + 立即跳登录页，再异步 signOut
        // 避免 signOut 网络失败/超时导致"点击退出没反应"
        App.logout = function () {
          clearAllAuthState();
          const goLogin = function() {
            try { window.location.replace("login.html"); }
            catch (e) { window.location.href = "login.html"; }
          };
          goLogin();
          setTimeout(goLogin, 50);
          setTimeout(goLogin, 500);
          supabase.auth.signOut().catch(function(e) {
            console.error("[auth-guard] signOut 异常:", e);
          });
        };

        // 同步更新顶栏用户名
        App.loadUserInfo();

        // 关键修复：角色和权限加载完成后，触发页面重新检查权限
        // 因为页面可能在 auth-guard 异步完成前就已渲染（使用默认角色 'user'）
        // 重新执行 enforcePagePermission 以应用正确的角色权限
        try {
          if (typeof App.enforcePagePermission === 'function' && window._currentPageModule) {
            App.enforcePagePermission(window._currentPageModule);
          }
          // 派发全局事件，让各页面自行刷新（如 settings.html 重新渲染权限矩阵）
          window.dispatchEvent(new CustomEvent('auth-role-updated', {
            detail: { role: finalRole, email: user.email, userId: user.id }
          }));
        } catch(e) {}
      }
    } catch (e) {
      // 加载 supabase 失败（网络/CDN）— 检查是否有本地会话
      console.error("[auth-guard] 加载 Supabase 失败:", e);
      const session = readSupabaseSession();
      if (!session || !session.user) {
        clearAllAuthState();
        try {
          window.location.replace("login.html");
        } catch (e2) {
          window.location.href = "login.html";
        }
      }
      // 若有本地会话但 CDN 失败，允许离线使用（等网络恢复后重新校验）
    }
  })();
})();
