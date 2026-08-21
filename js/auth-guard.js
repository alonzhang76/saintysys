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
  }

  // 把 Supabase user 映射为系统原有的用户结构，保证 App.* 兼容
  function mapSupabaseUser(user) {
    if (!user) return null;
    const email = user.email || "";
    const meta = user.user_metadata || {};
    // 优先从 user_metadata 中读取角色（如果有设置）
    let role = meta.role || "user";
    // 检查管理员邮箱列表（从 admin-config.js 暴露到 window）
    const adminEmails = window.ADMIN_EMAILS || [];
    if (adminEmails.indexOf(email) >= 0) {
      role = "admin";
    }
    // 关键修复：如果 user_metadata.role 还是默认的 'user'（auth-guard 异步未完成），
    // 优先使用「设置」页面中管理员在本地 users 列表配置的角色，
    // 这样页面初次渲染（auth-guard 未完成时）也能用正确的角色查权限
    if (role === "user" && email && window.App) {
      try {
        const localUsers = window.App.store.get("users", []);
        const localUser = localUsers.find((u) => u.email === email);
        if (localUser && localUser.role) role = localUser.role;
      } catch (e) {}
    }
    // 异步从 Supabase user_roles 表读取真实角色
    // 如果 user_metadata 没有设置，会在异步守卫中更新
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
   */
  function overrideAppSync() {
    if (typeof window.App === "undefined" || !window.App) return;

    // App.checkLogin：同步检查 localStorage 中的 Supabase 会话
    App.checkLogin = function () {
      const session = readSupabaseSession();
      if (!session || !session.user) {
        clearAllAuthState();
        try {
          window.location.replace("login.html");
        } catch (e) {
          window.location.href = "login.html";
        }
        return false;
      }
      return true;
    };

    // App.getCurrentUser：返回映射后的 Supabase 用户
    App.getCurrentUser = function () {
      // 优先使用异步守卫已设置的 window.currentSupabaseUser
      if (window.currentSupabaseUser) {
        return mapSupabaseUser(window.currentSupabaseUser);
      }
      const session = readSupabaseSession();
      if (session && session.user) {
        return mapSupabaseUser(session.user);
      }
      return null;
    };

    // App.loadUserInfo：用 Supabase 用户名更新顶栏
    App.loadUserInfo = function () {
      let username = "管理员";
      const cu = window.currentSupabaseUser;
      if (cu) {
        username =
          (cu.user_metadata && cu.user_metadata.username) ||
          (cu.email ? cu.email.split("@")[0] : "用户");
      } else {
        const session = readSupabaseSession();
        if (session && session.user) {
          const u = session.user;
          username =
            (u.user_metadata && u.user_metadata.username) ||
            (u.email ? u.email.split("@")[0] : "用户");
        }
      }
      const userEl = document.querySelector(".header-user .user-name");
      if (userEl) userEl.textContent = username;
    };

    // App.logout：先清本地态，再异步 signOut，最后跳登录页
    // （若异步守卫已覆盖此方法为更完整版本，会以异步守卫版本为准）
    App.logout = function () {
      clearAllAuthState();
      // 尽力调用 signOut（动态 import，失败不影响跳转）
      import("./supabase.js")
        .then(function (mod) {
          return mod.supabase.auth.signOut().catch(function () {});
        })
        .catch(function () {})
        .finally(function () {
          try {
            window.location.replace("login.html");
          } catch (e) {
            window.location.href = "login.html";
          }
        });
    };
  }

  /* ---------- 同步预检：无 Supabase 会话立即跳登录 ----------
   * 对没有 common.js / App 的独立页面（如 shipping documents.html）尤其重要
   * 对有 App 的页面，与 App.checkLogin() 互为冗余双保险，均跳 login.html
   */
  var _preSession = readSupabaseSession();
  if (!_preSession || !_preSession.user) {
    clearAllAuthState();
    try {
      window.location.replace("login.html");
    } catch (e) {
      window.location.href = "login.html";
    }
    // 标记，让异步守卫不再执行
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
        // 会话无效或已过期
        console.error("[auth-guard] 未登录或会话失效:", error);
        clearAllAuthState();
        try {
          window.location.replace("login.html");
        } catch (e) {
          window.location.href = "login.html";
        }
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

        // 关键修复：优先使用「设置」页面中管理员配置的本地 users 列表的角色
        // 因为 settings.html 的 saveUser() 只写入本地 users 列表，不写入 SQL user_roles 表，
        // 如果不检查本地 users 列表，管理员在设置中分配的 manager/merchandiser 等角色不会生效
        let localUserRole = null;
        try {
          if (window.App) {
            const localUsers = window.App.store.get('users', []);
            const localUser = localUsers.find(u => u.email === user.email);
            if (localUser && localUser.role) localUserRole = localUser.role;
          }
        } catch(e) {}

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
        App.logout = async function () {
          try {
            await supabase.auth.signOut();
          } catch (e) {
            console.error("[auth-guard] signOut 异常:", e);
          }
          clearAllAuthState();
          try {
            window.location.replace("login.html");
          } catch (e) {
            window.location.href = "login.html";
          }
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
