-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Creates profiles (with roles) and submissions, plus row-level security so
-- students only see their own work and only teachers can grade.

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student', 'teacher')),
  created_at timestamptz not null default now()
);

-- Create a profile automatically when someone registers.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_teacher()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own or teacher" on public.profiles;
create policy "profiles: read own or teacher" on public.profiles
  for select using (id = auth.uid() or public.is_teacher());
-- No insert/update policies: profiles are created by the trigger and roles are
-- changed only from the SQL editor, so a student cannot make themselves a teacher.

-- ---------- submissions ----------
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  test text not null check (test ~ '^[0-9]{1,2}[A-Z]$'),  -- lesson code, e.g. '1A'
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'graded')),
  auto_score numeric,
  max_score numeric,
  review jsonb not null default '{}'::jsonb,
  grade int check (grade between 1 and 5),
  teacher_comment text,
  submitted_at timestamptz,
  graded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (student_id, test)
);

create index if not exists submissions_status_idx on public.submissions (status);

alter table public.submissions enable row level security;

drop policy if exists "submissions: read own or teacher" on public.submissions;
create policy "submissions: read own or teacher" on public.submissions
  for select using (student_id = auth.uid() or public.is_teacher());

drop policy if exists "submissions: student inserts own" on public.submissions;
create policy "submissions: student inserts own" on public.submissions
  -- 'returned' is allowed because the site saves with upsert (insert ... on conflict update).
  for insert with check (student_id = auth.uid() and status in ('draft', 'returned', 'submitted'));

-- Students can edit only while the work is a draft or returned for revision.
drop policy if exists "submissions: student updates own draft" on public.submissions;
create policy "submissions: student updates own draft" on public.submissions
  for update using (student_id = auth.uid() and status in ('draft', 'returned'))
  with check (student_id = auth.uid() and status in ('draft', 'returned', 'submitted'));

drop policy if exists "submissions: teacher updates" on public.submissions;
create policy "submissions: teacher updates" on public.submissions
  for update using (public.is_teacher()) with check (public.is_teacher());

drop policy if exists "submissions: teacher deletes" on public.submissions;
create policy "submissions: teacher deletes" on public.submissions
  for delete using (public.is_teacher());

-- Students must not be able to write grades or teacher comments.
create or replace function public.protect_teacher_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_teacher() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.review := '{}'::jsonb;
    new.grade := null;
    new.teacher_comment := null;
    new.graded_at := null;
  else
    new.review := old.review;
    new.grade := old.grade;
    new.teacher_comment := old.teacher_comment;
    new.graded_at := old.graded_at;
    new.student_id := old.student_id;
    new.test := old.test;
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_protect on public.submissions;
create trigger submissions_protect
  before insert or update on public.submissions
  for each row execute function public.protect_teacher_fields();

-- ---------- make a teacher ----------
-- After the teacher registers on the site, run (with their e-mail):
-- update public.profiles set role = 'teacher'
--   where id = (select id from auth.users where email = 'teacher@example.com');
