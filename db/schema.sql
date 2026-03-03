create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  timezone text not null default 'UTC',
  streak_count integer not null default 0,
  last_active_date date,
  xp integer not null default 0,
  level text not null default 'Beginner',
  total_questions integer not null default 0,
  correct_answers integer not null default 0,
  is_admin boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  question_number integer not null default 1 check (question_number >= 1),
  prompt text not null,
  ideal_answer text not null,
  key_points text[] not null default '{}',
  difficulty integer not null default 1 check (difficulty between 1 and 5),
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.daily_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  day date not null,
  unlocked_at timestamptz not null default timezone('utc'::text, now()),
  attempted_at timestamptz,
  locked boolean not null default false,
  gave_up boolean not null default false,
  user_answer text,
  ai_score integer,
  ai_feedback jsonb,
  xp_earned integer not null default 0,
  hints_used integer not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (user_id, question_id, day)
);

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  daily_question_id uuid not null references public.daily_questions(id) on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (user_id, daily_question_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.performance_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  total_xp integer not null default 0,
  average_score numeric(5, 2) not null default 0,
  accuracy_pct integer not null default 0,
  streak integer not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (user_id, day)
);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user_profile();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists questions_set_updated_at on public.questions;
create trigger questions_set_updated_at
before update on public.questions
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.topics enable row level security;
alter table public.questions enable row level security;
alter table public.daily_questions enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.performance_history enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "topics_read_all" on public.topics;
create policy "topics_read_all"
on public.topics
for select
to authenticated
using (true);

drop policy if exists "questions_read_all" on public.questions;
create policy "questions_read_all"
on public.questions
for select
to authenticated
using (active = true or exists (
  select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
));

drop policy if exists "questions_admin_write" on public.questions;
create policy "questions_admin_write"
on public.questions
for all
to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists "topics_admin_write" on public.topics;
create policy "topics_admin_write"
on public.topics
for all
to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists "daily_questions_own" on public.daily_questions;
create policy "daily_questions_own"
on public.daily_questions
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "chat_sessions_own" on public.chat_sessions;
create policy "chat_sessions_own"
on public.chat_sessions
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "chat_messages_own" on public.chat_messages;
create policy "chat_messages_own"
on public.chat_messages
for all
to authenticated
using (
  exists (
    select 1 from public.chat_sessions cs
    where cs.id = session_id and cs.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.chat_sessions cs
    where cs.id = session_id and cs.user_id = auth.uid()
  )
);

drop policy if exists "performance_own" on public.performance_history;
create policy "performance_own"
on public.performance_history
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_daily_questions_user_day on public.daily_questions (user_id, day);
create index if not exists idx_chat_messages_session_created on public.chat_messages (session_id, created_at);
create index if not exists idx_performance_history_user_day on public.performance_history (user_id, day);

alter table public.questions
add column if not exists question_number integer not null default 1;

create index if not exists idx_questions_topic_number on public.questions (topic_id, question_number);
