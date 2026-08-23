-- ============================================================
-- 增量补丁：订单跨机同步 + 款式图跨模块共享 专用 RLS
-- 适用场景：
--   1) 同一"公司"下所有员工共享 app_data_store（所有订单、样衣、通讯录…）
--   2) 款式图允许：
--        · 桶根直接上传 GW27-003.png
--        · 款号文件夹  {styleNo}/xxx.png
--        · 用户文件夹  {userId}/consumption|order|sample/...
-- ============================================================
-- 使用方法：Supabase 控制台 → SQL Editor → 新建查询 → 整段粘贴 → 执行
-- 执行完成后不会破坏已有数据，只需刷新浏览器即可。
-- ============================================================

-- ====== 一、app_data_store：所有登录用户共享读写（公司级共享数据） ======
alter table if exists public.app_data_store enable row level security;

-- 先清掉可能存在的旧策略（per-user 隔离模式）
drop policy if exists "own_data_store"       on public.app_data_store;
drop policy if exists "shared_data_store"    on public.app_data_store;
drop policy if exists "shared_app_data_read" on public.app_data_store;
drop policy if exists "shared_app_data_write" on public.app_data_store;

-- 读：任意已登录用户都能看到整张表的所有 store_key
create policy "shared_app_data_read"
  on public.app_data_store
  for select
  using (auth.role() = 'authenticated');

-- 写（insert/update/delete 合并）：任意已登录用户都能写入整张表
create policy "shared_app_data_write"
  on public.app_data_store
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');


-- ====== 二、storage.objects：app-photos 桶对 authenticated 全开读写 ======
-- 原因：原策略只允许上传到 {userId}/，但新的跨模块共享图片存在
--       ① 桶根 GW27-003.png ② {styleNo}/款式图.png 两种位置。
--       只有把 INSERT/DELETE/UPDATE 放开给 authenticated，这些路径才能写成功。
--       SELECT 放开给 authenticated 后，LIST/sign 才不会在 RLS 层返回空。
-- 注意：因为 anon role 没被放行，未登录用户依然无法读写，数据仍是私有的。
drop policy if exists "users can upload own files"          on storage.objects;
drop policy if exists "users can read own files"            on storage.objects;
drop policy if exists "authenticated can read all files"    on storage.objects;
drop policy if exists "users can delete own files"          on storage.objects;
drop policy if exists "users can update own files"          on storage.objects;
drop policy if exists "app-photos authenticated read"      on storage.objects;
drop policy if exists "app-photos authenticated insert"    on storage.objects;
drop policy if exists "app-photos authenticated update"    on storage.objects;
drop policy if exists "app-photos authenticated delete"    on storage.objects;

-- 读：登录后可列出 / sign 桶里所有图片（用于 findStyleImages / LIST API）
create policy "app-photos authenticated read"
  on storage.objects
  for select
  using (bucket_id = 'app-photos' and auth.role() = 'authenticated');

-- 写：登录后可往桶里任意路径写入（兼容 {userId}/ 与 {styleNo}/ 与桶根）
create policy "app-photos authenticated insert"
  on storage.objects
  for insert
  with check (bucket_id = 'app-photos' and auth.role() = 'authenticated');

-- 改：登录后可覆盖任意路径的文件
create policy "app-photos authenticated update"
  on storage.objects
  for update
  using     (bucket_id = 'app-photos' and auth.role() = 'authenticated')
  with check (bucket_id = 'app-photos' and auth.role() = 'authenticated');

-- 删：登录后可删除任意路径的文件（含共享的 {styleNo}/ 图片）
create policy "app-photos authenticated delete"
  on storage.objects
  for delete
  using (bucket_id = 'app-photos' and auth.role() = 'authenticated');


-- ====== 三、确保 unique(store_key) 约束存在（否则独立写入 on_conflict=store_key 会 409） ======
do $$
declare
  conname_record record;
begin
  for conname_record in
    select conname from pg_constraint
    where conrelid = 'public.app_data_store'::regclass
      and contype = 'u'
      and conname <> 'app_data_store_store_key_key'
  loop
    execute 'alter table public.app_data_store drop constraint if exists ' || quote_ident(conname_record.conname);
  end loop;
end $$;

alter table public.app_data_store
  drop constraint if exists app_data_store_store_key_key;
alter table public.app_data_store
  add constraint app_data_store_store_key_key unique (store_key);

create index if not exists idx_app_data_store_key
  on public.app_data_store (store_key);

-- ============================================================
-- ✅ 补丁执行完毕。
-- 验证步骤：
--   1) Supabase → Authentication → 用户：确保你们两台电脑登录的邮箱都存在。
--   2) Supabase → Table Editor → app_data_store：手动改一条 orders.payload，
--      刷新两台电脑的 order.html，订单列表都应立刻更新（15 秒内）。
--   3) Supabase → Storage → app-photos：把一张 GW27-003.png 拖进桶根，
--      刷新 order.html 的订单列表，款号=GW27-003 的行应显示缩略图。
-- ============================================================
