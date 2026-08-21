-- ============================================================
-- 舜天汉唐服装外贸系统 - 用户角色与权限 SQL 脚本
-- 在 Supabase → SQL Editor 中执行
-- ============================================================

-- ===== 一、用户角色表 =====
-- 存储每个用户的角色，支持多角色（如一个用户同时是 merchandiser + sample admin）
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz default now(),
  unique(user_id, role)
);

-- ===== 二、模块权限配置表 =====
-- 替代原 permissions JSON 对象，支持按角色+模块精细控制
create table if not exists public.module_permissions (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  module text not null,
  permission text not null check (permission in ('write', 'read', 'none')),
  unique(role, module)
);

-- ===== 三、is_admin() 函数 =====
-- 检查指定用户是否为管理员
create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = check_user_id
      and role = 'admin'
  );
$$;

-- ===== 四、has_module_permission() 函数 =====
-- 检查指定用户对指定模块的权限
create or replace function public.has_module_permission(
  module_name text,
  check_user_id uuid default auth.uid()
)
returns text  -- 'write' | 'read' | 'none'
language sql
stable
security definer
set search_path = public
as $$
  with user_user_roles as (
    select role
    from public.user_roles
    where user_id = check_user_id
  ),
  best_perm as (
    select mp.permission,
           case mp.permission
             when 'write' then 3
             when 'read' then 2
             when 'none' then 1
             else 0
           end as priority
    from public.module_permissions mp
    where mp.module = module_name
      and mp.role in (select role from user_user_roles)
  )
  select coalesce(
    (select permission from best_perm order by priority desc limit 1),
    -- 默认权限：如果找不到配置，根据 user_roles 中的角色推断
    case
      when exists (select 1 from user_user_roles where role = 'admin') then 'write'
      when exists (select 1 from user_user_roles where role = 'manager') then 'write'
      when exists (select 1 from user_user_roles where role = 'user') then 'write'
      else 'none'
    end
  );
$$;

-- ===== 五、初始化数据 =====

-- 5.1 初始化超级管理员角色
-- 管理员邮箱列表（前端 admin-config.js 中配置的邮箱应与此保持一致）
-- 请在下面修改为你的管理员邮箱
insert into public.user_roles (user_id, role)
select id, 'admin'
from auth.users
where email in ('alonzhang76@outlook.com')
on conflict (user_id, role) do nothing;

-- 5.2 初始化所有用户的基础角色（如果还没有的话）
-- 给每个用户至少一个 'user' 角色
insert into public.user_roles (user_id, role)
select id, 'user'
from auth.users
where not exists (
  select 1 from public.user_roles ur where ur.user_id = auth.users.id
)
on conflict (user_id, role) do nothing;

-- 5.3 初始化模块权限配置
-- 格式：(role, module, permission)
-- 管理员对所有模块有写权限
insert into public.module_permissions (role, module, permission) values
  ('admin', 'order', 'write'),
  ('admin', 'sample', 'write'),
  ('admin', 'shipping', 'write'),
  ('admin', 'express', 'write'),
  ('admin', 'contacts', 'write'),
  ('admin', 'maintenance', 'write'),
  ('admin', 'settings', 'write'),
  ('admin', 'finance', 'write'),
  ('admin', 'production', 'write'),
  ('admin', 'wash', 'write'),
  ('admin', 'fabric', 'write'),
  ('admin', 'accessory', 'write'),
  ('admin', 'feedback', 'write'),
  ('admin', 'shipping_documents', 'write'),

  -- 普通用户默认有写权限（确保新系统可用）
  ('user', 'order', 'write'),
  ('user', 'sample', 'write'),
  ('user', 'shipping', 'write'),
  ('user', 'express', 'write'),
  ('user', 'contacts', 'write'),
  ('user', 'maintenance', 'write'),
  ('user', 'settings', 'read'),
  ('user', 'finance', 'read'),
  ('user', 'production', 'write'),
  ('user', 'wash', 'write'),
  ('user', 'fabric', 'write'),
  ('user', 'accessory', 'write'),
  ('user', 'feedback', 'write'),
  ('user', 'shipping_documents', 'write'),

  -- 管理层
  ('manager', 'order', 'write'),
  ('manager', 'sample', 'write'),
  ('manager', 'shipping', 'write'),
  ('manager', 'express', 'write'),
  ('manager', 'contacts', 'write'),
  ('manager', 'maintenance', 'write'),
  ('manager', 'settings', 'read'),
  ('manager', 'finance', 'write'),
  ('manager', 'production', 'write'),
  ('manager', 'wash', 'write'),
  ('manager', 'fabric', 'write'),
  ('manager', 'accessory', 'write'),
  ('manager', 'feedback', 'write'),
  ('manager', 'shipping_documents', 'write'),

  -- 业务跟单员
  ('merchandiser', 'order', 'write'),
  ('merchandiser', 'sample', 'write'),
  ('merchandiser', 'shipping', 'write'),
  ('merchandiser', 'express', 'write'),
  ('merchandiser', 'contacts', 'write'),
  ('merchandiser', 'maintenance', 'read'),
  ('merchandiser', 'settings', 'none'),
  ('merchandiser', 'finance', 'read'),
  ('merchandiser', 'production', 'read'),
  ('merchandiser', 'wash', 'write'),
  ('merchandiser', 'fabric', 'read'),
  ('merchandiser', 'accessory', 'read'),
  ('merchandiser', 'feedback', 'write'),
  ('merchandiser', 'shipping_documents', 'write'),

  -- 采购员
  ('purchaser', 'order', 'read'),
  ('purchaser', 'sample', 'read'),
  ('purchaser', 'shipping', 'read'),
  ('purchaser', 'express', 'write'),
  ('purchaser', 'contacts', 'write'),
  ('purchaser', 'maintenance', 'write'),
  ('purchaser', 'settings', 'none'),
  ('purchaser', 'finance', 'read'),
  ('purchaser', 'production', 'read'),
  ('purchaser', 'wash', 'read'),
  ('purchaser', 'fabric', 'write'),
  ('purchaser', 'accessory', 'write'),
  ('purchaser', 'feedback', 'read'),
  ('purchaser', 'shipping_documents', 'read'),

  -- 样衣师
  ('designer', 'order', 'read'),
  ('designer', 'sample', 'write'),
  ('designer', 'shipping', 'none'),
  ('designer', 'express', 'read'),
  ('designer', 'contacts', 'read'),
  ('designer', 'maintenance', 'read'),
  ('designer', 'settings', 'none'),
  ('designer', 'finance', 'none'),
  ('designer', 'production', 'read'),
  ('designer', 'wash', 'write'),
  ('designer', 'fabric', 'read'),
  ('designer', 'accessory', 'read'),
  ('designer', 'feedback', 'read'),
  ('designer', 'shipping_documents', 'none'),

  -- 品控员
  ('qc', 'order', 'read'),
  ('qc', 'sample', 'read'),
  ('qc', 'shipping', 'read'),
  ('qc', 'express', 'read'),
  ('qc', 'contacts', 'read'),
  ('qc', 'maintenance', 'read'),
  ('qc', 'settings', 'none'),
  ('qc', 'finance', 'none'),
  ('qc', 'production', 'write'),
  ('qc', 'wash', 'read'),
  ('qc', 'fabric', 'read'),
  ('qc', 'accessory', 'read'),
  ('qc', 'feedback', 'read'),
  ('qc', 'shipping_documents', 'read'),

  -- 财务专员
  ('finance', 'order', 'read'),
  ('finance', 'sample', 'none'),
  ('finance', 'shipping', 'read'),
  ('finance', 'express', 'read'),
  ('finance', 'contacts', 'read'),
  ('finance', 'maintenance', 'read'),
  ('finance', 'settings', 'none'),
  ('finance', 'finance', 'write'),
  ('finance', 'production', 'read'),
  ('finance', 'wash', 'none'),
  ('finance', 'fabric', 'read'),
  ('finance', 'accessory', 'read'),
  ('finance', 'feedback', 'none'),
  ('finance', 'shipping_documents', 'read'),

  -- 单证员
  ('documentary', 'order', 'write'),
  ('documentary', 'sample', 'read'),
  ('documentary', 'shipping', 'write'),
  ('documentary', 'express', 'write'),
  ('documentary', 'contacts', 'write'),
  ('documentary', 'maintenance', 'read'),
  ('documentary', 'settings', 'none'),
  ('documentary', 'finance', 'read'),
  ('documentary', 'production', 'read'),
  ('documentary', 'wash', 'read'),
  ('documentary', 'fabric', 'read'),
  ('documentary', 'accessory', 'read'),
  ('documentary', 'feedback', 'read'),
  ('documentary', 'shipping_documents', 'write')

on conflict (role, module) do nothing;

-- ===== 六、RLS 策略 =====

-- 6.1 user_roles 表：用户只能查看自己的角色
alter table public.user_roles enable row level security;

drop policy if exists "user_roles_select_own" on public.user_roles;
create policy "user_roles_select_own"
  on public.user_roles
  for select
  using (auth.uid() = user_id);

-- 管理员可以为所有人分配角色
drop policy if exists "user_roles_admin_write" on public.user_roles;
create policy "user_roles_admin_write"
  on public.user_roles
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- 6.2 module_permissions 表：所有人可读，仅管理员可修改
alter table public.module_permissions enable row level security;

drop policy if exists "module_permissions_select" on public.module_permissions;
create policy "module_permissions_select"
  on public.module_permissions
  for select
  using (true);  -- 所有人可读（用于前端检查权限）

drop policy if exists "module_permissions_admin_write" on public.module_permissions;
create policy "module_permissions_admin_write"
  on public.module_permissions
  for all
  using (public.is_admin())
  with check (public.is_admin());

-- ===== 七、在 app_data_store 中添加角色数据 =====
-- 将 user_roles 信息同步到 app_data_store，方便前端读取
-- （实际由前端在登录后调用 is_admin() 或 has_module_permission() 获取）

-- ============================================================
-- ✅ 完成！
-- 验证步骤：
-- 1. 在 Table Editor 查看 user_roles 和 module_permissions 表
-- 2. 在 SQL Editor 执行：select public.is_admin(); 应返回 true（如果你是管理员）
-- 3. 执行：select public.has_module_permission('sample'); 应返回 'write'
-- 4. 重新登录系统验证页面权限
-- ============================================================
