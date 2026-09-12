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

-- ---------- 5. 写权限 401 专项修复 ----------
-- 症状：浏览器控制台 PATCH/POST .../rdb/rest/app_data_store 返回 401，
--       消息 "permission denied for table app_data_store"（SELECT 正常、写失败）。
-- 原因：控制台手动建表通常只给 authenticated 授予了 SELECT，缺少 INSERT/UPDATE/DELETE；
--       或第 2 节 GRANT 执行时角色不存在而整条脚本中断。
-- 本段可独立、重复执行（幂等）。
-- ⚠️ 执行方式：请「整段一起执行」；若 DO 块报 "permission denied to create role"，
--    说明控制台账号无建角色权限（PG 环境通常已内置 anon/authenticated），
--    注释掉下面这个 DO 块后继续执行其余 GRANT 语句即可。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'CREATE ROLE authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'CREATE ROLE anon';
  END IF;
END $$;

-- schema 连接权限
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;

-- 已存在表：登录用户完全读写，匿名只读（比第 2 节单表 GRANT 更兜底）
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT                         ON ALL TABLES IN SCHEMA public TO anon;

-- 今后新建的表自动继承同样权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;

-- 再次确保 RLS 策略存在（CREATE POLICY 要求表已存在，故对五张表逐一处理）
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_data_store','user_roles','module_permissions','app_submissions','submission_files'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_auth_all', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t||'_auth_all', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_anon_read', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (true)', t||'_anon_read', t);
    END IF;
  END LOOP;
END $$;

-- ---------- 6. 诊断（执行后把结果发给排查人员） ----------
-- 当前会话身份：
SELECT current_user AS current_user, session_user AS session_user;
-- 三个前端角色是否存在（authenticated / anon / service_role 都应能查到）：
SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') ORDER BY rolname;
-- authenticated 对各表的实际权限（应有 SELECT/INSERT/UPDATE/DELETE 四行）：
SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS grants
FROM information_schema.role_table_grants
WHERE grantee = 'authenticated' AND table_schema = 'public'
GROUP BY table_name
ORDER BY table_name;
-- RLS 是否开启（rowsecurity 应为 true）：
SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
ORDER BY relname;

-- ---------- 7. PG 云存储：创建业务 Bucket + RLS 策略 ----------
-- 症状：前端上传报 404 STORAGE_BUCKET_NOT_FOUND，或
--       "invalid ... must be alphanumeric/hyphens/underscores, 3-63 chars"；
--       JS SDK listBuckets() 返回 []（环境还没有任何 Bucket）。
-- 原因：PG 模式环境不会自动配好 Bucket，必须先在 storage.buckets 建桶，
--       且 storage.objects 的唯一权限闸门是 RLS Policy（默认无任何策略 = 全部拒绝）。
-- 本段幂等，可整段重复执行。

-- 7.1 创建业务桶 app-photos（前端 STORAGE_BUCKET 常量同名；≤20MB；不限制文件类型）
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('app-photos', 'app-photos', true, 20 * 1024 * 1024, NULL)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 7.2 storage.buckets：anon/authenticated 均可读取桶元数据（前端列桶/校验用）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='buckets' AND policyname='buckets_read_all') THEN
    CREATE POLICY buckets_read_all ON storage.buckets
      FOR SELECT TO anon, authenticated USING (true);
  END IF;
END $$;

-- 7.3 storage.objects：本系统为全员共享工作区——登录用户可读写删 app-photos 全部对象，
--     匿名用户只读（保证登录页/签名链接等场景的图片可读）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='app_photos_anon_select') THEN
    CREATE POLICY app_photos_anon_select ON storage.objects
      FOR SELECT TO anon
      USING (bucket_id = 'app-photos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='app_photos_auth_all') THEN
    CREATE POLICY app_photos_auth_all ON storage.objects
      FOR ALL TO authenticated
      USING (bucket_id = 'app-photos')
      WITH CHECK (bucket_id = 'app-photos');
  END IF;
END $$;

-- 7.4 验证（桶应返回 1 行；策略应返回 3 行）：
-- SELECT id, name, public, file_size_limit FROM storage.buckets ORDER BY id;
-- SELECT policyname, roles, cmd FROM pg_policies
--   WHERE schemaname='storage' AND tablename IN ('buckets','objects') ORDER BY policyname;
