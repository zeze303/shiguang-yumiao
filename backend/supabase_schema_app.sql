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
  role text not null default 'volunteer' check (role in ('volunteer', 'admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);
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
