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
export const SUPABASE_URL = "https://ugoyacuagslqhqguxyqe.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnb3lhY3VhZ3NscWhxZ3V4eXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzI5NTUsImV4cCI6MjEwMjUwODk1NX0._GdWOGWblSpOYm3y8f_d3aVQszfn2YbRjHN0FqZiLtI";

// ===== Storage Bucket 名称（私有 Bucket，不使用公开 URL）=====
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

// ===== 创建 Supabase 客户端（esm.sh + jsdelivr 双 CDN 容错）=====
// 优先 esm.sh，若加载失败由各调用方 fallback
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// 同时暴露到全局，供非模块脚本（supabase-store.js 等）使用
window.supabase = supabase;
window.SUPABASE_URL = SUPABASE_URL;
window.STORAGE_BUCKET = STORAGE_BUCKET;
window.SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;

// 配置占位符检查（修正：当且仅当仍为占位符时才警告）
if (
  SUPABASE_URL.indexOf("请替换") >= 0 ||
  SUPABASE_PUBLISHABLE_KEY.indexOf("请替换") >= 0
) {
  console.warn(
    "[supabase.js] SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY 仍是占位符，请先填写真实配置后再使用。"
  );
}
