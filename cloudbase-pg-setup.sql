-- ============================================================
-- CloudBase PostgreSQL 环境建表脚本（AA服装外贸系统）
-- ============================================================
-- 执行位置：腾讯云开发控制台 → SQL 型数据库 → SQL 窗口/SQL 执行
-- 说明：
--   1. 本环境为 PostgreSQL 实例（pgdb-*），无文档型数据库。
--   2. 业务行统一存储为 { id: text 主键, data: jsonb 业务字段 }，
--      前端兼容层（js/cloudbase.js）负责展开/合并，对业务代码透明。
--   3. 脚本可重复执行（幂等）：表用 IF NOT EXISTS，策略先 DROP 再建。
--   4. 默认以管理员身份执行，GRANT anon 仅开放只读（未登录/匿名只可读）。
-- ============================================================

-- ---------- 1. 建表 ----------
CREATE TABLE IF NOT EXISTS public.app_data_store (
  id   text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id   text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.module_permissions (
  id   text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.app_submissions (
  id   text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.submission_files (
  id   text PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------- 2. 授权（表级 GRANT） ----------
-- 登录用户（authenticated）：完全读写
-- 匿名（anon）：只读（如无需匿名读可删除对应 GRANT 和策略）
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_data_store       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_permissions   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_submissions      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.submission_files     TO authenticated;

GRANT SELECT ON public.app_data_store     TO anon;
GRANT SELECT ON public.user_roles         TO anon;
GRANT SELECT ON public.module_permissions TO anon;
GRANT SELECT ON public.app_submissions    TO anon;
GRANT SELECT ON public.submission_files   TO anon;

-- ---------- 3. 行级安全（RLS） ----------
-- app_data_store
ALTER TABLE public.app_data_store ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_data_store_auth_all ON public.app_data_store;
CREATE POLICY app_data_store_auth_all ON public.app_data_store
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS app_data_store_anon_read ON public.app_data_store;
CREATE POLICY app_data_store_anon_read ON public.app_data_store
  FOR SELECT TO anon USING (true);

-- user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_roles_auth_all ON public.user_roles;
CREATE POLICY user_roles_auth_all ON public.user_roles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS user_roles_anon_read ON public.user_roles;
CREATE POLICY user_roles_anon_read ON public.user_roles
  FOR SELECT TO anon USING (true);

-- module_permissions
ALTER TABLE public.module_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS module_permissions_auth_all ON public.module_permissions;
CREATE POLICY module_permissions_auth_all ON public.module_permissions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS module_permissions_anon_read ON public.module_permissions;
CREATE POLICY module_permissions_anon_read ON public.module_permissions
  FOR SELECT TO anon USING (true);

-- app_submissions
ALTER TABLE public.app_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_submissions_auth_all ON public.app_submissions;
CREATE POLICY app_submissions_auth_all ON public.app_submissions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS app_submissions_anon_read ON public.app_submissions;
CREATE POLICY app_submissions_anon_read ON public.app_submissions
  FOR SELECT TO anon USING (true);

-- submission_files
ALTER TABLE public.submission_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS submission_files_auth_all ON public.submission_files;
CREATE POLICY submission_files_auth_all ON public.submission_files
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS submission_files_anon_read ON public.submission_files;
CREATE POLICY submission_files_anon_read ON public.submission_files
  FOR SELECT TO anon USING (true);

-- ---------- 4. 验证 ----------
-- 执行完成后可运行以下语句验证：
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public';
-- SELECT * FROM public.app_data_store LIMIT 1;
