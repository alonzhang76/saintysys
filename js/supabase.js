/* ===== 公共 Supabase 客户端模块 =====
 * 使用浏览器原生 ES Module + CDN，不依赖 npm / package.json
 * 所有需要 Supabase 的脚本统一从此文件导入 supabase
 *
 * 部署前请把下面两个占位符替换成你自己的 Supabase 项目配置：
 *   - SUPABASE_URL             Supabase 项目 URL，例如 https://xxxxxxxx.supabase.co
 *   - SUPABASE_PUBLISHABLE_KEY  Supabase 公开发布密钥（anon key），可在
 *                               Project Settings → API 中找到
 *
 * 安全说明：
 *   - 这里只放 publishable / anon key，不要放 service_role key
 *   - 真正的权限控制由 Supabase RLS（行级安全）策略保证
 *   - 前端代码不保存任何数据库密码或 service_role key
 */

// ===== Supabase 项目配置（请替换为你的真实值）=====
export const SUPABASE_URL = "请替换成我的 Supabase Project URL";
export const SUPABASE_PUBLISHABLE_KEY = "请替换成我的 Supabase Publishable key";

// ===== Storage Bucket 名称（私有 Bucket，不使用公开 URL）=====
export const STORAGE_BUCKET = "app-photos";

// 单文件最大 5MB
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

// 允许的图片 MIME 类型
export const ALLOWED_IMAGE_MIME = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
];

// ===== 创建 Supabase 客户端 =====
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // 持久化到 localStorage，刷新后保持登录
    persistSession: true,
    // 自动刷新 token
    autoRefreshToken: true,
    // 自动从 URL 恢复会话（用于邮件确认回调等）
    detectSessionInUrl: true,
  },
});

// 兼容性提示：当用户未替换占位符时给出明确警告
if (
  SUPABASE_URL.startsWith("请替换") ||
  SUPABASE_PUBLISHABLE_KEY.startsWith("请替换")
) {
  console.warn(
    "[supabase.js] 检测到 SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY 仍是占位符，请先在 js/supabase.js 中填写真实配置后再使用。"
  );
}
