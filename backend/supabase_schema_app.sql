-- 独立后端迁移：在已有 growth_students / growth_records 的同一 Supabase 库执行。
-- 不修改 growth_* 表。其 id 为 text，新表使用 text UUID 与之兼容。
begin;

create table if not exists public.app_volunteers (
  id text primary key default gen_random_uuid()::text,
  openid text not null unique,
  name text not null default '',
  phone text not null default '',
  avatar text not null default '',
  org text not null default '',
  role text not null default 'guest' check (role in ('guest', 'volunteer', 'admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);
-- Upgrade existing installs without changing any existing account role.
alter table public.app_volunteers alter column role set default 'guest';
alter table public.app_volunteers drop constraint if exists app_volunteers_role_check;
alter table public.app_volunteers add constraint app_volunteers_role_check check (role in ('guest', 'volunteer', 'admin'));

create table if not exists public.app_invite_codes (
  id text primary key default gen_random_uuid()::text,
  code text not null unique,
  target_role text not null check (target_role in ('volunteer', 'admin')),
  created_by text not null references public.app_volunteers(id) on delete restrict,
  used_by text references public.app_volunteers(id) on delete restrict,
  used_at timestamptz,
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'used', 'revoked')),
  created_at timestamptz not null default now(),
  check ((status = 'used' and used_by is not null and used_at is not null)
    or (status in ('active', 'revoked') and used_by is null and used_at is null))
);
create index if not exists idx_app_invites_creator on public.app_invite_codes(created_by);
create index if not exists idx_app_invites_user on public.app_invite_codes(used_by);
create index if not exists idx_app_invites_created on public.app_invite_codes(created_at desc);
create index if not exists idx_app_invites_active_expiry on public.app_invite_codes(expires_at) where status = 'active';
alter table public.app_invite_codes enable row level security;
revoke all on public.app_invite_codes from anon, authenticated;
grant all on public.app_invite_codes to service_role;

-- These RPCs run as service_role only. Lock account before invite for a consistent lock order.
-- Role upgrade and invite consumption commit or roll back together.
create or replace function public.app_redeem_invite(p_code text, p_volunteer_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  account public.app_volunteers%rowtype;
  invitation public.app_invite_codes%rowtype;
  current_rank integer;
  target_rank integer;
begin
  select * into account from public.app_volunteers where id = p_volunteer_id for update;
  if not found or account.status <> 'active' then return jsonb_build_object('error', 'INVITE_FORBIDDEN'); end if;
  select * into invitation from public.app_invite_codes where code = upper(trim(p_code)) for update;
  if not found or invitation.status <> 'active' or invitation.used_by is not null or invitation.used_at is not null
    or (invitation.expires_at is not null and invitation.expires_at <= clock_timestamp()) then
    return jsonb_build_object('error', 'INVITE_INVALID');
  end if;
  current_rank := case account.role when 'guest' then 0 when 'volunteer' then 1 when 'admin' then 2 else 99 end;
  target_rank := case invitation.target_role when 'volunteer' then 1 when 'admin' then 2 else -1 end;
  if target_rank <= current_rank then return jsonb_build_object('error', 'INVITE_NO_UPGRADE'); end if;
  update public.app_volunteers set role = invitation.target_role where id = account.id;
  update public.app_invite_codes set status = 'used', used_by = account.id, used_at = clock_timestamp() where id = invitation.id;
  return jsonb_build_object('role', invitation.target_role);
end;
$$;
create or replace function public.app_revoke_invite(p_id text, p_actor_id text)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  account public.app_volunteers%rowtype;
  invitation public.app_invite_codes%rowtype;
begin
  select * into account from public.app_volunteers where id = p_actor_id for update;
  if not found or account.status <> 'active' or account.role <> 'admin' then return jsonb_build_object('error', 'INVITE_FORBIDDEN'); end if;
  select * into invitation from public.app_invite_codes where id = p_id for update;
  if not found then return jsonb_build_object('error', 'INVITE_NOT_FOUND'); end if;
  if invitation.status = 'used' then return jsonb_build_object('error', 'INVITE_ALREADY_USED'); end if;
  update public.app_invite_codes set status = 'revoked' where id = p_id returning * into invitation;
  return to_jsonb(invitation);
end;
$$;
revoke all on function public.app_redeem_invite(text, text), public.app_revoke_invite(text, text) from public, anon, authenticated;
grant execute on function public.app_redeem_invite(text, text), public.app_revoke_invite(text, text) to service_role;

create table if not exists public.app_sessions (
  token text primary key,
  volunteer_id text not null references public.app_volunteers(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create table if not exists public.app_relations (
  id text primary key default gen_random_uuid()::text,
  volunteer_id text not null references public.app_volunteers(id) on delete cascade,
  student_id text not null references public.growth_students(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (volunteer_id, student_id)
);
create table if not exists public.app_companion_logs (
  id text primary key default gen_random_uuid()::text,
  volunteer_id text not null references public.app_volunteers(id) on delete cascade,
  student_id text not null references public.growth_students(id) on delete cascade,
  type text not null check (type in ('探访', '通话', '活动', '其他')),
  content text not null,
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  created_at timestamptz not null default now()
);
create table if not exists public.app_growth_poems (
  id text primary key default gen_random_uuid()::text,
  student_id text not null references public.growth_students(id) on delete cascade,
  period text not null,
  title text not null,
  content text not null,
  cover_url text not null default '',
  created_by text references public.app_volunteers(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.app_ai_suggestions (
  id text primary key default gen_random_uuid()::text,
  student_id text not null references public.growth_students(id) on delete cascade,
  volunteer_id text not null references public.app_volunteers(id) on delete cascade,
  kind text not null check (kind in ('suggest', 'poem')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  model text not null default 'deepseek-chat',
  created_at timestamptz not null default now()
);

-- openid 与 (volunteer_id, student_id) 唯一约束已自动创建索引。
create index if not exists idx_app_sessions_volunteer on public.app_sessions(volunteer_id);
create index if not exists idx_app_sessions_expiry on public.app_sessions(expires_at);
create index if not exists idx_app_relations_student on public.app_relations(student_id);
create index if not exists idx_app_logs_volunteer_time on public.app_companion_logs(volunteer_id, created_at desc);
create index if not exists idx_app_logs_student_time on public.app_companion_logs(student_id, created_at desc);
create index if not exists idx_app_poems_student_period on public.app_growth_poems(student_id, period, created_at desc);
create index if not exists idx_app_poems_creator on public.app_growth_poems(created_by);
create index if not exists idx_app_ai_student_volunteer_kind_time on public.app_ai_suggestions(student_id, volunteer_id, kind, created_at desc);
create index if not exists idx_app_ai_volunteer on public.app_ai_suggestions(volunteer_id);

-- 所有 app_* 数据经后端 service_role 访问；禁止客户端匿名/登录角色直连。
alter table public.app_volunteers enable row level security;
alter table public.app_sessions enable row level security;
alter table public.app_relations enable row level security;
alter table public.app_companion_logs enable row level security;
alter table public.app_growth_poems enable row level security;
alter table public.app_ai_suggestions enable row level security;
revoke all on public.app_volunteers, public.app_sessions, public.app_relations,
  public.app_companion_logs, public.app_growth_poems, public.app_ai_suggestions from anon, authenticated;
grant all on public.app_volunteers, public.app_sessions, public.app_relations,
  public.app_companion_logs, public.app_growth_poems, public.app_ai_suggestions to service_role;
commit;
