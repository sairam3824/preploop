create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  timezone text not null default 'Asia/Kolkata',
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
  session_summary text not null default '',
  summary_updated_at timestamptz,
  last_message_preview text not null default '',
  last_message_at timestamptz,
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

create table if not exists public.topic_mastery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  mastery_score numeric(5, 2) not null default 0,
  attempts integer not null default 0,
  correct_attempts integer not null default 0,
  last_score integer,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (user_id, topic_id)
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  scope text not null check (scope in ('daily', 'weekly')),
  metric text not null check (
    metric in ('complete_questions', 'correct_answers', 'no_hint_wins', 'direct_matches', 'topic_diversity')
  ),
  target integer not null check (target > 0),
  xp_reward integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.user_mission_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  progress integer not null default 0,
  completed boolean not null default false,
  claimed boolean not null default false,
  completed_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique (user_id, mission_id, period_start)
);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  category text not null check (category in ('streak', 'accuracy', 'xp', 'direct_match', 'mastery')),
  threshold integer not null check (threshold > 0),
  xp_reward integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default timezone('utc'::text, now()),
  xp_awarded integer not null default 0,
  unique (user_id, achievement_id)
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

drop trigger if exists topic_mastery_set_updated_at on public.topic_mastery;
create trigger topic_mastery_set_updated_at
before update on public.topic_mastery
for each row execute function public.set_updated_at();

drop trigger if exists user_mission_progress_set_updated_at on public.user_mission_progress;
create trigger user_mission_progress_set_updated_at
before update on public.user_mission_progress
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.topics enable row level security;
alter table public.questions enable row level security;
alter table public.daily_questions enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.performance_history enable row level security;
alter table public.topic_mastery enable row level security;
alter table public.missions enable row level security;
alter table public.user_mission_progress enable row level security;
alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;

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

drop policy if exists "topic_mastery_own" on public.topic_mastery;
create policy "topic_mastery_own"
on public.topic_mastery
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "missions_read_all" on public.missions;
create policy "missions_read_all"
on public.missions
for select
to authenticated
using (true);

drop policy if exists "achievements_read_all" on public.achievements;
create policy "achievements_read_all"
on public.achievements
for select
to authenticated
using (true);

drop policy if exists "user_mission_progress_own" on public.user_mission_progress;
create policy "user_mission_progress_own"
on public.user_mission_progress
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user_achievements_own" on public.user_achievements;
create policy "user_achievements_own"
on public.user_achievements
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists idx_daily_questions_user_day on public.daily_questions (user_id, day);
create index if not exists idx_chat_messages_session_created on public.chat_messages (session_id, created_at);
create index if not exists idx_performance_history_user_day on public.performance_history (user_id, day);
create index if not exists idx_topic_mastery_user on public.topic_mastery (user_id, mastery_score desc);
create index if not exists idx_user_mission_progress_user_period on public.user_mission_progress (user_id, period_start desc);
create index if not exists idx_user_achievements_user on public.user_achievements (user_id, unlocked_at desc);

alter table public.questions
add column if not exists question_number integer not null default 1;

create index if not exists idx_questions_topic_number on public.questions (topic_id, question_number);

alter table public.chat_sessions
add column if not exists session_summary text not null default '';

alter table public.chat_sessions
add column if not exists summary_updated_at timestamptz;

alter table public.chat_sessions
add column if not exists last_message_preview text not null default '';

alter table public.chat_sessions
add column if not exists last_message_at timestamptz;

alter table public.profiles
alter column timezone set default 'Asia/Kolkata';

alter table public.profiles
add column if not exists streak_freezes integer not null default 0;

alter table public.profiles
add column if not exists last_freeze_grant_date date;

alter table public.topic_mastery
add column if not exists mastery_score numeric(5, 2) not null default 0;

alter table public.topic_mastery
add column if not exists attempts integer not null default 0;

alter table public.topic_mastery
add column if not exists correct_attempts integer not null default 0;

alter table public.topic_mastery
add column if not exists last_score integer;

alter table public.user_mission_progress
add column if not exists claimed boolean not null default false;

alter table public.user_mission_progress
add column if not exists claimed_at timestamptz;

insert into public.missions (code, name, description, scope, metric, target, xp_reward, active)
values
  ('daily_complete_1', 'Daily Starter', 'Complete 1 question today', 'daily', 'complete_questions', 1, 12, true),
  ('daily_no_hint_1', 'Clean Solve', 'Finish 1 question without hints', 'daily', 'no_hint_wins', 1, 16, true),
  ('daily_direct_match_1', 'Perfect Match', 'Get 1 direct-match answer today', 'daily', 'direct_matches', 1, 22, true),
  ('weekly_complete_5', 'Weekly Grinder', 'Complete 5 questions this week', 'weekly', 'complete_questions', 5, 40, true),
  ('weekly_topics_3', 'Breadth Builder', 'Complete questions from 3 topics this week', 'weekly', 'topic_diversity', 3, 35, true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  scope = excluded.scope,
  metric = excluded.metric,
  target = excluded.target,
  xp_reward = excluded.xp_reward,
  active = excluded.active;

insert into public.achievements (code, name, description, category, threshold, xp_reward, active)
values
  ('streak_7', '7-Day Streak', 'Practice for 7 straight days', 'streak', 7, 40, true),
  ('streak_30', '30-Day Streak', 'Practice for 30 straight days', 'streak', 30, 120, true),
  ('xp_1000', 'XP 1000', 'Reach 1000 total XP', 'xp', 1000, 80, true),
  ('direct_match_10', 'Direct Match x10', 'Get 10 direct-match answers', 'direct_match', 10, 100, true),
  ('mastery_80', 'Topic Master', 'Reach mastery score 80 in any topic', 'mastery', 80, 90, true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  threshold = excluded.threshold,
  xp_reward = excluded.xp_reward,
  active = excluded.active;

update public.profiles
set timezone = 'Asia/Kolkata'
where timezone is distinct from 'Asia/Kolkata';
