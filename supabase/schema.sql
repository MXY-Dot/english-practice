-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- It is safe to run again after changes.
--
-- Roles:
--  * Everyone registers on the site with their own e-mail and password.
--  * A teacher registers with the TEACHER CODE (set it below) and becomes 'teacher'.
--  * A teacher picks ("claims") students; a teacher sees and grades only their own students.
--  * Students see only their own work and cannot change grades.

-- ---------- settings: the teacher code ----------
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);
alter table public.app_settings enable row level security;  -- no policies: not readable through the API

-- ⚠️ CHANGE 'teacher-2026' to your own secret code, then run the script.
insert into public.app_settings (key, value) values ('teacher_code', 'teacher-2026')
  on conflict (key) do update set value = excluded.value;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student', 'teacher')),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists teacher_id uuid references public.profiles (id) on delete set null;
-- 'm' / 'f' for the words учитель/учительница, ученик/ученица. Empty for old accounts until the user picks.
alter table public.profiles add column if not exists gender text check (gender in ('m', 'f'));

-- The sign-up form can check the code before creating the account.
create or replace function public.check_teacher_code(code text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.app_settings where key = 'teacher_code' and value = code);
$$;
grant execute on function public.check_teacher_code(text) to anon, authenticated;

-- Create a profile automatically when someone registers.
-- The role is 'teacher' only when the correct teacher code was sent with the sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, gender)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when public.check_teacher_code(coalesce(new.raw_user_meta_data ->> 'teacher_code', '')) then 'teacher' else 'student' end,
    case when new.raw_user_meta_data ->> 'gender' in ('m', 'f') then new.raw_user_meta_data ->> 'gender' end
  );
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

-- True when the student belongs to the current teacher.
create or replace function public.is_my_student(sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = sid and teacher_id = auth.uid());
$$;

-- The current user's teacher (so a student can see their teacher's name).
create or replace function public.my_teacher_id()
returns uuid language sql security definer stable set search_path = public as $$
  select teacher_id from public.profiles where id = auth.uid();
$$;

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own or teacher" on public.profiles;
drop policy if exists "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles
  for select using (
    id = auth.uid()
    or (public.is_teacher() and role = 'student')   -- teachers see the student list to pick students
    or id = public.my_teacher_id()                   -- students see their teacher
  );
-- No insert/update policies: profiles are created by the trigger and changed only
-- through the functions below, so a student cannot make themselves a teacher.

-- A teacher adds a student who has no teacher yet.
create or replace function public.claim_student(sid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_teacher() then raise exception 'Добавлять учеников может только учитель.'; end if;
  update public.profiles set teacher_id = auth.uid()
    where id = sid and role = 'student' and (teacher_id is null or teacher_id = auth.uid());
  if not found then raise exception 'У этого ученика уже есть учитель.'; end if;
end;
$$;

-- A teacher removes one of their students.
create or replace function public.release_student(sid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set teacher_id = null where id = sid and teacher_id = auth.uid();
end;
$$;
grant execute on function public.claim_student(uuid), public.release_student(uuid) to authenticated;

-- Anyone sets their own gender (only this one column of their own profile).
create or replace function public.set_my_gender(g text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if g not in ('m', 'f') then raise exception 'Неверное значение.'; end if;
  update public.profiles set gender = g where id = auth.uid();
end;
$$;
grant execute on function public.set_my_gender(text) to authenticated;

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
drop policy if exists "submissions: read" on public.submissions;
create policy "submissions: read" on public.submissions
  for select using (student_id = auth.uid() or public.is_my_student(student_id));

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
  for update using (public.is_my_student(student_id)) with check (public.is_my_student(student_id));

drop policy if exists "submissions: teacher deletes" on public.submissions;
create policy "submissions: teacher deletes" on public.submissions
  for delete using (public.is_my_student(student_id));

-- Students must not be able to write grades or teacher comments.
create or replace function public.protect_teacher_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_teacher() and public.is_my_student(new.student_id) then
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

-- ---------- confirm e-mails automatically ----------
-- Works even when "Confirm email" is still on in Authentication settings:
-- new accounts are marked as confirmed, so people can log in right after signing up.
create or replace function public.auto_confirm_email()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$;

drop trigger if exists auto_confirm_email on auth.users;
create trigger auto_confirm_email
  before insert on auth.users
  for each row execute function public.auto_confirm_email();
