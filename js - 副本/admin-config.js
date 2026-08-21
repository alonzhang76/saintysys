/* ===== 管理员邮箱配置（集中管理，前端只控制界面显示）=====
 *
 * 安全说明：
 *   - 前端 ADMIN_EMAILS 仅用于控制界面按钮/菜单的显示
 *   - 不能依靠前端隐藏按钮实现真正的管理员权限
 *   - 真正的权限控制必须在 Supabase 后台通过 RLS（行级安全）策略实现
 *   - 如果页面需要查看全部 app_submissions（跨用户），必须在
 *     Supabase 中增加管理员 RLS 策略后才能读取全部数据
 *   - 普通用户页面必须始终限制 user_id = 当前用户 id
 *
 * 使用方法：
 *   - 部署前把下面的邮箱替换成你的管理员 Supabase 账号邮箱
 *   - 可以配置多个管理员邮箱
 */

export const ADMIN_EMAILS = ["alonzhang76@outlook.com"];

/**
 * 判断当前 Supabase 用户是否为管理员
 * @param {{email?: string}|null} user - supabase.auth.getUser() 返回的 user 对象
 * @returns {boolean}
 */
export function isAdmin(user) {
  if (!user || !user.email) return false;
  return ADMIN_EMAILS
    .map((e) => e.trim().toLowerCase())
    .includes(user.email.trim().toLowerCase());
}

// 暴露到 window，方便非模块脚本使用
if (typeof window !== "undefined") {
  window.ADMIN_EMAILS = ADMIN_EMAILS;
  window.isAdmin = isAdmin;
}
