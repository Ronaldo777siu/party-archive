-- ============================================================
-- 党务档案管理小程序 · Supabase 数据库初始化脚本
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴本脚本 → Run
-- ============================================================

-- ---------- 1. 用户角色表 profiles ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  role        text not null check (role in ('admin','viewer')),
  created_at  timestamptz not null default now()
);

-- ---------- 2. 党员/入党人员档案表 members ----------
create table if not exists public.members (
  id               bigint generated always as identity primary key,
  class_name       text not null,                -- 班级
  name             text not null,                -- 姓名
  student_id       text,                         -- 学号
  gender           text,                         -- 性别
  birth_date       date,                         -- 出生日期
  ethnicity        text,                         -- 民族
  political_status text,                         -- 政治面貌
  id_card          text,                         -- 身份证号
  join_league_date date,                         -- 入团年月
  party_qi         text,                         -- 入党期数（如 56期）
  current_stage    text not null default '入党申请人'
                   check (current_stage in ('入党申请人','入党积极分子','发展对象','预备党员','正式党员')),
  apply_date       date,                         -- 入党申请时间
  talk_date        date,                         -- 谈话时间
  recommend_date   date,                         -- 推优时间
  activist_date    date,                         -- 积极分子确定时间
  develop_date     date,                         -- 发展对象确定时间
  probation_date   date,                         -- 接收为预备党员时间
  full_date        date,                         -- 转正时间
  introducer       text,                         -- 介绍人
  status_flag      text default '继续发展'
                   check (status_flag in ('继续发展','已退出','转出','转入','待确认')),
  remark           text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 查询索引：班级+姓名 高频查询
create index if not exists idx_members_class_name on public.members (class_name, name);
create index if not exists idx_members_qi_stage on public.members (party_qi, current_stage);

-- ---------- 3. 更新日志表 update_logs ----------
create table if not exists public.update_logs (
  id         bigint generated always as identity primary key,
  operator   text not null,                      -- 操作账号
  action     text not null,                      -- insert / update / upload_excel / upload_word
  target     text not null,                      -- 目标（班级+姓名 / 文件名）
  detail     jsonb,                              -- 变更详情
  created_at timestamptz not null default now()
);

-- ---------- 4. 辅助函数 ----------
-- 当前登录人档案（security definer，避免 RLS 递归）
create or replace function public.get_my_profile()
returns public.profiles
language sql stable security definer
set search_path = public
as $$
  select * from public.profiles where id = auth.uid()
$$;

-- 当前登录人是否为管理员
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- 时间线逻辑校验：返回异常提示；为空表示通过
create or replace function public.check_timeline(
  p_apply date, p_talk date, p_recommend date, p_activist date,
  p_develop date, p_probation date, p_full date
) returns text
language plpgsql immutable
as $$
begin
  -- 逐阶段先后校验：后一阶段时间不得早于前一阶段
  if p_apply is not null and p_talk is not null and p_talk < p_apply then
    return '谈话时间早于入党申请时间';
  end if;
  if p_talk is not null and p_recommend is not null and p_recommend < p_talk then
    return '推优时间早于谈话时间';
  end if;
  if p_recommend is not null and p_activist is not null and p_activist < p_recommend then
    return '积极分子确定时间早于推优时间';
  end if;
  if p_activist is not null and p_develop is not null and p_develop < p_activist then
    return '发展对象确定时间早于积极分子确定时间';
  end if;
  if p_develop is not null and p_probation is not null and p_probation < p_develop then
    return '接收预备党员时间早于发展对象确定时间';
  end if;
  if p_probation is not null and p_full is not null and p_full < p_probation then
    return '转正时间早于接收预备党员时间';
  end if;
  return null;
end;
$$;

-- ---------- 5. 行级安全 RLS ----------
alter table public.profiles enable row level security;
alter table public.members  enable row level security;
alter table public.update_logs enable row level security;

-- profiles：已登录用户可读自己（函数限行），只有管理员可改
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
  for select to authenticated using (auth.uid() = id or public.is_admin());
drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write" on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- members：登录用户可查；仅管理员可增删改
drop policy if exists "members_select_auth" on public.members;
create policy "members_select_auth" on public.members
  for select to authenticated using (true);
drop policy if exists "members_admin_write" on public.members;
create policy "members_admin_write" on public.members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- update_logs：登录用户可查（审计可见），仅管理员写入
drop policy if exists "logs_select_auth" on public.update_logs;
create policy "logs_select_auth" on public.update_logs
  for select to authenticated using (true);
drop policy if exists "logs_admin_write" on public.update_logs;
create policy "logs_admin_write" on public.update_logs
  for insert to authenticated with check (public.is_admin());

-- 更新时间自动刷新
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_members_updated on public.members;
create trigger trg_members_updated
  before update on public.members
  for each row execute function public.set_updated_at();

-- ---------- 完成提示 ----------
select 'schema init ok' as status;
