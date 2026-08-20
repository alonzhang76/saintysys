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

        if (!rolesError && rolesData && rolesData.length > 0) {
          const roles = rolesData.map(r => r.role);
          // 优先取 admin，其次 manager，最后取第一个角色
          let finalRole = 'user';
          if (roles.indexOf('admin') >= 0) finalRole = 'admin';
          else if (roles.indexOf('manager') >= 0) finalRole = 'manager';
          else finalRole = roles[0];

          // 更新 App 用户信息
          if (window.App && window.App._currentUser) {
            window.App._currentUser.role = finalRole;
          }
          console.log('[auth-guard] 用户角色:', finalRole, '| 所有角色:', roles);

          // 加载用户对各模块的权限
          try {
            const { data: permsData, error: permsError } = await supabase
              .from('module_permissions')
              .select('module, permission')
              .in('role', roles);

            if (!permsError && permsData) {
              // 合并权限：取最高优先级
              const priority = { write: 3, read: 2, none: 1 };
              const merged = {};
              permsData.forEach(p => {
                const mod = p.module;
                if (!merged[mod] || priority[p.permission] > priority[merged[mod]]) {
                  merged[mod] = p.permission;
                }
              });
              // 更新 App 的用户模块权限缓存
              if (window.App) {
                window.App._userModulePerms = merged;
              }
              console.log('[auth-guard] 模块权限已加载:', merged);
            }
          } catch (e) {
            console.warn('[auth-guard] 加载模块权限失败:', e);
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
