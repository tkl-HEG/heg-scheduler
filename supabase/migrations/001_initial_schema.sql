-- Scheduler v2 initial Supabase/Postgres schema.
-- The existing HTML/JavaScript prototype stores data in localStorage arrays.
-- This schema normalizes those arrays while preserving legacy ids for import.

create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  create type public.import_source_kind as enum ('prototype_seed', 'prototype_export', 'excel', 'manual');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.competency_level as enum ('primary', 'secondary');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.period_unit as enum ('weeks', 'days');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.subject_priority as enum ('high', 'medium', 'low');
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  timezone text not null default 'Europe/Copenhagen',
  block_hours numeric(4, 2) not null default 1.50 check (block_hours > 0),
  max_week smallint not null default 60 check (max_week between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index schools_organization_id_idx on public.schools(organization_id);

create trigger schools_set_updated_at
before update on public.schools
for each row execute function public.set_updated_at();

create table public.data_imports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  source_kind public.import_source_kind not null,
  source_name text,
  import_version text,
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index data_imports_school_id_idx on public.data_imports(school_id);

create table public.school_weekdays (
  school_id uuid not null references public.schools(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  label text not null,
  short_label text not null,
  sort_order smallint not null,
  primary key (school_id, day_of_week)
);

create table public.school_blocks (
  school_id uuid not null references public.schools(id) on delete cascade,
  block_no smallint not null check (block_no > 0),
  label text not null,
  starts_at time,
  pair_no smallint,
  sort_order smallint not null,
  primary key (school_id, block_no)
);

create table public.campuses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name citext not null,
  legacy_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);

create index campuses_school_id_idx on public.campuses(school_id);

create trigger campuses_set_updated_at
before update on public.campuses
for each row execute function public.set_updated_at();

create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  legacy_id text,
  initials citext not null,
  display_name text,
  skills_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, initials)
);

create unique index teachers_school_legacy_id_key
on public.teachers(school_id, legacy_id)
where legacy_id is not null;

create index teachers_school_id_idx on public.teachers(school_id);

create trigger teachers_set_updated_at
before update on public.teachers
for each row execute function public.set_updated_at();

create table public.teacher_unavailable_days (
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  reason text,
  primary key (teacher_id, day_of_week)
);

create index teacher_unavailable_days_school_id_idx on public.teacher_unavailable_days(school_id);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  legacy_id text,
  name text not null,
  address_label text not null,
  capacity integer check (capacity is null or capacity > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, campus_id, name)
);

create unique index rooms_school_legacy_id_key
on public.rooms(school_id, legacy_id)
where legacy_id is not null;

create index rooms_school_id_idx on public.rooms(school_id);
create index rooms_campus_id_idx on public.rooms(campus_id);

create trigger rooms_set_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

create table public.class_groups (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  campus_id uuid references public.campuses(id) on delete set null,
  legacy_id text,
  name text not null,
  address_label text not null,
  preferred_room_id uuid references public.rooms(id) on delete set null deferrable initially deferred,
  default_period_weeks integer check (default_period_weeks is null or default_period_weeks > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);

create unique index class_groups_school_legacy_id_key
on public.class_groups(school_id, legacy_id)
where legacy_id is not null;

create index class_groups_school_id_idx on public.class_groups(school_id);
create index class_groups_campus_id_idx on public.class_groups(campus_id);
create index class_groups_preferred_room_id_idx on public.class_groups(preferred_room_id);

create trigger class_groups_set_updated_at
before update on public.class_groups
for each row execute function public.set_updated_at();

create table public.class_active_weeks (
  school_id uuid not null references public.schools(id) on delete cascade,
  class_group_id uuid not null references public.class_groups(id) on delete cascade,
  week_no smallint not null check (week_no between 1 and 80),
  primary key (class_group_id, week_no)
);

create index class_active_weeks_school_week_idx on public.class_active_weeks(school_id, week_no);

create table public.course_subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  normalized_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);

create unique index course_subjects_school_normalized_key
on public.course_subjects(school_id, normalized_key)
where normalized_key is not null;

create index course_subjects_school_id_idx on public.course_subjects(school_id);

create trigger course_subjects_set_updated_at
before update on public.course_subjects
for each row execute function public.set_updated_at();

create table public.teacher_competencies (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  course_subject_id uuid not null references public.course_subjects(id) on delete cascade,
  level public.competency_level not null default 'primary',
  source_import_id uuid references public.data_imports(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  unique (teacher_id, course_subject_id, level)
);

create index teacher_competencies_school_id_idx on public.teacher_competencies(school_id);
create index teacher_competencies_course_subject_id_idx on public.teacher_competencies(course_subject_id);

create table public.subject_pairing_groups (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  legacy_pairing_id text,
  name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subject_pairing_groups_school_legacy_id_key
on public.subject_pairing_groups(school_id, legacy_pairing_id)
where legacy_pairing_id is not null;

create index subject_pairing_groups_school_id_idx on public.subject_pairing_groups(school_id);

create trigger subject_pairing_groups_set_updated_at
before update on public.subject_pairing_groups
for each row execute function public.set_updated_at();

create table public.subject_offerings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  legacy_id text,
  class_group_id uuid not null references public.class_groups(id) on delete cascade,
  course_subject_id uuid not null references public.course_subjects(id) on delete restrict,
  pairing_group_id uuid references public.subject_pairing_groups(id) on delete set null,
  name text not null,
  total_hours numeric(7, 2) not null default 0 check (total_hours >= 0),
  hours_missing boolean not null default false,
  hours_source text,
  period_value integer not null default 1 check (period_value > 0),
  period_unit public.period_unit not null default 'weeks',
  start_week smallint not null default 1 check (start_week between 1 and 80),
  priority public.subject_priority not null default 'medium',
  sort_order integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subject_offerings_school_legacy_id_key
on public.subject_offerings(school_id, legacy_id)
where legacy_id is not null;

create index subject_offerings_school_id_idx on public.subject_offerings(school_id);
create index subject_offerings_class_group_id_idx on public.subject_offerings(class_group_id);
create index subject_offerings_course_subject_id_idx on public.subject_offerings(course_subject_id);
create index subject_offerings_pairing_group_id_idx on public.subject_offerings(pairing_group_id);

create trigger subject_offerings_set_updated_at
before update on public.subject_offerings
for each row execute function public.set_updated_at();

create table public.teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  subject_offering_id uuid not null references public.subject_offerings(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete restrict,
  assignment_order smallint not null default 1 check (assignment_order > 0),
  share_fraction numeric(6, 5) check (share_fraction is null or (share_fraction > 0 and share_fraction <= 1)),
  source_import_id uuid references public.data_imports(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  unique (subject_offering_id, teacher_id)
);

create index teaching_assignments_school_id_idx on public.teaching_assignments(school_id);
create index teaching_assignments_teacher_id_idx on public.teaching_assignments(teacher_id);

create table public.teacher_suggestions (
  school_id uuid not null references public.schools(id) on delete cascade,
  subject_offering_id uuid not null references public.subject_offerings(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  reason text,
  source_import_id uuid references public.data_imports(id) on delete set null,
  primary key (subject_offering_id, teacher_id)
);

create index teacher_suggestions_school_id_idx on public.teacher_suggestions(school_id);
create index teacher_suggestions_teacher_id_idx on public.teacher_suggestions(teacher_id);

create table public.lesson_bookings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  legacy_id text,
  subject_offering_id uuid not null references public.subject_offerings(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete restrict,
  teacher_id uuid references public.teachers(id) on delete set null,
  week_no smallint not null check (week_no between 1 and 80),
  day_of_week smallint not null,
  block_no smallint not null,
  source_import_id uuid references public.data_imports(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (school_id, day_of_week) references public.school_weekdays(school_id, day_of_week) on delete restrict,
  foreign key (school_id, block_no) references public.school_blocks(school_id, block_no) on delete restrict
);

create unique index lesson_bookings_school_legacy_id_key
on public.lesson_bookings(school_id, legacy_id)
where legacy_id is not null;

create index lesson_bookings_school_slot_idx on public.lesson_bookings(school_id, week_no, day_of_week, block_no);
create index lesson_bookings_subject_offering_id_idx on public.lesson_bookings(subject_offering_id);
create index lesson_bookings_room_id_idx on public.lesson_bookings(room_id);
create index lesson_bookings_teacher_id_idx on public.lesson_bookings(teacher_id);

create trigger lesson_bookings_set_updated_at
before update on public.lesson_bookings
for each row execute function public.set_updated_at();

create or replace function public.user_has_org_role(target_org_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_org_id
      and member.user_id = auth.uid()
      and member.role = any(allowed_roles)
  );
$$;

create or replace function public.user_can_read_school(target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.schools school
    where school.id = target_school_id
      and public.user_has_org_role(school.organization_id, array['owner', 'admin', 'editor', 'viewer'])
  );
$$;

create or replace function public.user_can_write_school(target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.schools school
    where school.id = target_school_id
      and public.user_has_org_role(school.organization_id, array['owner', 'admin', 'editor'])
  );
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.schools enable row level security;
alter table public.data_imports enable row level security;
alter table public.school_weekdays enable row level security;
alter table public.school_blocks enable row level security;
alter table public.campuses enable row level security;
alter table public.teachers enable row level security;
alter table public.teacher_unavailable_days enable row level security;
alter table public.rooms enable row level security;
alter table public.class_groups enable row level security;
alter table public.class_active_weeks enable row level security;
alter table public.course_subjects enable row level security;
alter table public.teacher_competencies enable row level security;
alter table public.subject_pairing_groups enable row level security;
alter table public.subject_offerings enable row level security;
alter table public.teaching_assignments enable row level security;
alter table public.teacher_suggestions enable row level security;
alter table public.lesson_bookings enable row level security;

create policy organizations_read on public.organizations
for select using (public.user_has_org_role(id, array['owner', 'admin', 'editor', 'viewer']));

create policy organizations_update on public.organizations
for update using (public.user_has_org_role(id, array['owner', 'admin']))
with check (public.user_has_org_role(id, array['owner', 'admin']));

create policy organization_members_read on public.organization_members
for select using (public.user_has_org_role(organization_id, array['owner', 'admin', 'editor', 'viewer']));

create policy organization_members_write on public.organization_members
for all using (public.user_has_org_role(organization_id, array['owner', 'admin']))
with check (public.user_has_org_role(organization_id, array['owner', 'admin']));

create policy schools_read on public.schools
for select using (public.user_can_read_school(id));

create policy schools_write on public.schools
for all using (public.user_can_write_school(id))
with check (public.user_can_write_school(id));

create policy data_imports_read on public.data_imports
for select using (public.user_can_read_school(school_id));

create policy data_imports_write on public.data_imports
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy school_weekdays_read on public.school_weekdays
for select using (public.user_can_read_school(school_id));

create policy school_weekdays_write on public.school_weekdays
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy school_blocks_read on public.school_blocks
for select using (public.user_can_read_school(school_id));

create policy school_blocks_write on public.school_blocks
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy campuses_read on public.campuses
for select using (public.user_can_read_school(school_id));

create policy campuses_write on public.campuses
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy teachers_read on public.teachers
for select using (public.user_can_read_school(school_id));

create policy teachers_write on public.teachers
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy teacher_unavailable_days_read on public.teacher_unavailable_days
for select using (public.user_can_read_school(school_id));

create policy teacher_unavailable_days_write on public.teacher_unavailable_days
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy rooms_read on public.rooms
for select using (public.user_can_read_school(school_id));

create policy rooms_write on public.rooms
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy class_groups_read on public.class_groups
for select using (public.user_can_read_school(school_id));

create policy class_groups_write on public.class_groups
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy class_active_weeks_read on public.class_active_weeks
for select using (public.user_can_read_school(school_id));

create policy class_active_weeks_write on public.class_active_weeks
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy course_subjects_read on public.course_subjects
for select using (public.user_can_read_school(school_id));

create policy course_subjects_write on public.course_subjects
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy teacher_competencies_read on public.teacher_competencies
for select using (public.user_can_read_school(school_id));

create policy teacher_competencies_write on public.teacher_competencies
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy subject_pairing_groups_read on public.subject_pairing_groups
for select using (public.user_can_read_school(school_id));

create policy subject_pairing_groups_write on public.subject_pairing_groups
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy subject_offerings_read on public.subject_offerings
for select using (public.user_can_read_school(school_id));

create policy subject_offerings_write on public.subject_offerings
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy teaching_assignments_read on public.teaching_assignments
for select using (public.user_can_read_school(school_id));

create policy teaching_assignments_write on public.teaching_assignments
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy teacher_suggestions_read on public.teacher_suggestions
for select using (public.user_can_read_school(school_id));

create policy teacher_suggestions_write on public.teacher_suggestions
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy lesson_bookings_read on public.lesson_bookings
for select using (public.user_can_read_school(school_id));

create policy lesson_bookings_write on public.lesson_bookings
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create or replace view public.v_lesson_booking_teachers
with (security_invoker = true)
as
select
  booking.id as booking_id,
  booking.school_id,
  booking.teacher_id
from public.lesson_bookings booking
where booking.teacher_id is not null
union
select
  booking.id as booking_id,
  booking.school_id,
  assignment.teacher_id
from public.lesson_bookings booking
join public.teaching_assignments assignment
  on assignment.subject_offering_id = booking.subject_offering_id
where booking.teacher_id is null;

create or replace view public.v_lesson_booking_context
with (security_invoker = true)
as
select
  booking.id as booking_id,
  booking.school_id,
  booking.subject_offering_id,
  booking.room_id,
  booking.teacher_id as explicit_teacher_id,
  booking.week_no,
  booking.day_of_week,
  booking.block_no,
  offering.class_group_id,
  offering.pairing_group_id,
  offering.name as subject_name,
  offering.total_hours,
  class_group.name as class_name,
  class_group.address_label as class_address_label,
  class_group.campus_id as class_campus_id,
  room.name as room_name,
  room.address_label as room_address_label,
  room.campus_id as room_campus_id
from public.lesson_bookings booking
join public.subject_offerings offering
  on offering.id = booking.subject_offering_id
join public.class_groups class_group
  on class_group.id = offering.class_group_id
join public.rooms room
  on room.id = booking.room_id;

create or replace view public.v_subject_status
with (security_invoker = true)
as
select
  offering.id as subject_offering_id,
  offering.school_id,
  offering.name,
  offering.class_group_id,
  offering.total_hours,
  greatest(0, ceiling(offering.total_hours / nullif(school.block_hours, 0))::integer) as required_blocks,
  count(booking.id)::integer as placed_blocks,
  greatest(
    0,
    greatest(0, ceiling(offering.total_hours / nullif(school.block_hours, 0))::integer) - count(booking.id)::integer
  ) as remaining_blocks,
  (offering.hours_missing or offering.total_hours <= 0) as has_missing_hours,
  not exists (
    select 1
    from public.teaching_assignments assignment
    where assignment.subject_offering_id = offering.id
  ) as has_missing_teacher,
  not exists (
    select 1
    from public.class_active_weeks active_week
    where active_week.class_group_id = offering.class_group_id
  ) as has_missing_active_weeks
from public.subject_offerings offering
join public.schools school
  on school.id = offering.school_id
left join public.lesson_bookings booking
  on booking.subject_offering_id = offering.id
group by
  offering.id,
  offering.school_id,
  offering.name,
  offering.class_group_id,
  offering.total_hours,
  offering.hours_missing,
  school.block_hours;

create or replace view public.v_subject_warnings
with (security_invoker = true)
as
select
  'missing_teacher'::text as warning_type,
  'Missing teacher'::text as title,
  status.school_id,
  status.subject_offering_id,
  null::uuid as booking_id,
  status.name || ' has no assigned teacher.' as message
from public.v_subject_status status
where status.has_missing_teacher
union all
select
  'missing_hours'::text as warning_type,
  'Missing hours'::text as title,
  status.school_id,
  status.subject_offering_id,
  null::uuid as booking_id,
  status.name || ' has no unambiguous hour budget.' as message
from public.v_subject_status status
where status.has_missing_hours
union all
select
  'missing_active_weeks'::text as warning_type,
  'Calendar rule'::text as title,
  status.school_id,
  status.subject_offering_id,
  null::uuid as booking_id,
  status.name || ' has no active calendar weeks for its class group.' as message
from public.v_subject_status status
where status.has_missing_active_weeks;

create or replace view public.v_booking_conflicts
with (security_invoker = true)
as
with paired_slot_exceptions as (
  select
    c1.booking_id as booking_id,
    c2.booking_id as conflicting_booking_id
  from public.v_lesson_booking_context c1
  join public.v_lesson_booking_context c2
    on c1.school_id = c2.school_id
   and c1.booking_id < c2.booking_id
   and c1.week_no = c2.week_no
   and c1.day_of_week = c2.day_of_week
   and c1.block_no = c2.block_no
   and c1.room_id = c2.room_id
   and c1.pairing_group_id is not null
   and c1.pairing_group_id = c2.pairing_group_id
),
slot_pairs as (
  select
    c1.booking_id,
    c2.booking_id as conflicting_booking_id,
    c1.school_id,
    c1.subject_offering_id,
    c1.class_group_id,
    c2.class_group_id as conflicting_class_group_id,
    c1.room_id,
    c2.room_id as conflicting_room_id
  from public.v_lesson_booking_context c1
  join public.v_lesson_booking_context c2
    on c1.school_id = c2.school_id
   and c1.booking_id < c2.booking_id
   and c1.week_no = c2.week_no
   and c1.day_of_week = c2.day_of_week
   and c1.block_no = c2.block_no
  left join paired_slot_exceptions exception
    on exception.booking_id = c1.booking_id
   and exception.conflicting_booking_id = c2.booking_id
  where exception.booking_id is null
),
budgeted_bookings as (
  select
    booking.id as booking_id,
    booking.school_id,
    booking.subject_offering_id,
    row_number() over (
      partition by booking.subject_offering_id
      order by booking.week_no, booking.day_of_week, booking.block_no, booking.created_at, booking.id
    ) as placement_no,
    greatest(0, ceiling(offering.total_hours / nullif(school.block_hours, 0))::integer) as required_blocks,
    offering.name as subject_name
  from public.lesson_bookings booking
  join public.subject_offerings offering
    on offering.id = booking.subject_offering_id
  join public.schools school
    on school.id = booking.school_id
)
select
  'invalid_block_pair'::text as conflict_type,
  'Block pair'::text as title,
  booking.school_id,
  booking.subject_offering_id,
  booking.id as booking_id,
  null::uuid as conflicting_booking_id,
  'The lesson is not placed as part of a valid block pair.'::text as message
from public.lesson_bookings booking
join public.school_blocks current_block
  on current_block.school_id = booking.school_id
 and current_block.block_no = booking.block_no
where not exists (
  select 1
  from public.lesson_bookings other_booking
  join public.school_blocks other_block
    on other_block.school_id = other_booking.school_id
   and other_block.block_no = other_booking.block_no
  where other_booking.id <> booking.id
    and other_booking.subject_offering_id = booking.subject_offering_id
    and other_booking.week_no = booking.week_no
    and other_booking.day_of_week = booking.day_of_week
    and current_block.pair_no is not null
    and other_block.pair_no = current_block.pair_no
    and other_booking.block_no <> booking.block_no
)
union all
select
  'inactive_class_week'::text,
  'Calendar rule'::text,
  context.school_id,
  context.subject_offering_id,
  context.booking_id,
  null::uuid,
  context.class_name || ' is not active in week ' || context.week_no || '.' as message
from public.v_lesson_booking_context context
where exists (
    select 1
    from public.class_active_weeks active_week
    where active_week.class_group_id = context.class_group_id
  )
  and not exists (
    select 1
    from public.class_active_weeks active_week
    where active_week.class_group_id = context.class_group_id
      and active_week.week_no = context.week_no
  )
union all
select
  'blocked_teacher_day'::text,
  'Teacher availability'::text,
  booking_teacher.school_id,
  booking.subject_offering_id,
  booking.id,
  null::uuid,
  teacher.initials || ' is unavailable on this weekday.' as message
from public.v_lesson_booking_teachers booking_teacher
join public.lesson_bookings booking
  on booking.id = booking_teacher.booking_id
join public.teacher_unavailable_days unavailable
  on unavailable.teacher_id = booking_teacher.teacher_id
 and unavailable.day_of_week = booking.day_of_week
join public.teachers teacher
  on teacher.id = booking_teacher.teacher_id
union all
select
  'address_mismatch'::text,
  'Wrong address'::text,
  context.school_id,
  context.subject_offering_id,
  context.booking_id,
  null::uuid,
  context.room_name || ' is at ' || context.room_address_label || ', but ' || context.class_name || ' is tied to ' || context.class_address_label || '.' as message
from public.v_lesson_booking_context context
where (
    context.class_campus_id is not null
    and context.room_campus_id is not null
    and context.class_campus_id <> context.room_campus_id
  )
  or (
    (context.class_campus_id is null or context.room_campus_id is null)
    and lower(context.class_address_label) <> lower(context.room_address_label)
  )
union all
select
  'subject_budget_overflow'::text,
  'Block budget'::text,
  budgeted.school_id,
  budgeted.subject_offering_id,
  budgeted.booking_id,
  null::uuid,
  budgeted.subject_name || ' has more placed blocks than its hour budget allows.' as message
from budgeted_bookings budgeted
where budgeted.placement_no > budgeted.required_blocks
union all
select
  'teacher_double_booking'::text,
  'Double booking'::text,
  pair.school_id,
  pair.subject_offering_id,
  pair.booking_id,
  pair.conflicting_booking_id,
  teacher.initials || ' is double booked in the same block.' as message
from slot_pairs pair
join public.v_lesson_booking_teachers teacher_1
  on teacher_1.booking_id = pair.booking_id
join public.v_lesson_booking_teachers teacher_2
  on teacher_2.booking_id = pair.conflicting_booking_id
 and teacher_2.teacher_id = teacher_1.teacher_id
join public.teachers teacher
  on teacher.id = teacher_1.teacher_id
union all
select
  'class_double_booking'::text,
  'Double booking'::text,
  pair.school_id,
  pair.subject_offering_id,
  pair.booking_id,
  pair.conflicting_booking_id,
  'Class group is double booked in the same block.'::text as message
from slot_pairs pair
where pair.class_group_id = pair.conflicting_class_group_id
union all
select
  'room_double_booking'::text,
  'Double booking'::text,
  pair.school_id,
  pair.subject_offering_id,
  pair.booking_id,
  pair.conflicting_booking_id,
  'Room is double booked in the same block.'::text as message
from slot_pairs pair
where pair.room_id = pair.conflicting_room_id
union all
select
  'transport_between_campuses'::text,
  'Transport rule'::text,
  c1.school_id,
  c1.subject_offering_id,
  c1.booking_id,
  c2.booking_id,
  teacher.initials || ' changes address between paired blocks.' as message
from public.v_lesson_booking_context c1
join public.v_lesson_booking_context c2
  on c1.school_id = c2.school_id
 and c1.booking_id < c2.booking_id
 and c1.week_no = c2.week_no
 and c1.day_of_week = c2.day_of_week
join public.school_blocks b1
  on b1.school_id = c1.school_id
 and b1.block_no = c1.block_no
join public.school_blocks b2
  on b2.school_id = c2.school_id
 and b2.block_no = c2.block_no
 and b2.pair_no = b1.pair_no
 and b2.block_no <> b1.block_no
join public.v_lesson_booking_teachers bt1
  on bt1.booking_id = c1.booking_id
join public.v_lesson_booking_teachers bt2
  on bt2.booking_id = c2.booking_id
 and bt2.teacher_id = bt1.teacher_id
join public.teachers teacher
  on teacher.id = bt1.teacher_id
where b1.pair_no is not null
  and (
    (c1.room_campus_id is not null and c2.room_campus_id is not null and c1.room_campus_id <> c2.room_campus_id)
    or (
      (c1.room_campus_id is null or c2.room_campus_id is null)
      and lower(c1.room_address_label) <> lower(c2.room_address_label)
    )
  );

comment on table public.teachers is 'Prototype teachers[]. Legacy id examples: teacher-aaf, teacher-tkl.';
comment on table public.class_groups is 'Prototype classes[]. Stores hold, address/campus, preferred room and active weeks.';
comment on table public.rooms is 'Prototype rooms[]. Rooms are scoped to a school and optionally a campus.';
comment on table public.subject_offerings is 'Prototype subjects[]. A subject offering is a course subject taught to one class group.';
comment on table public.teaching_assignments is 'Prototype subject.teacherIds normalized to one row per selected teacher.';
comment on table public.lesson_bookings is 'Prototype bookings[]. A booking is one week/day/block placement.';
comment on view public.v_booking_conflicts is 'Query-time conflict checks mirroring the prototype rules.';
comment on view public.v_subject_warnings is 'Subject-level warnings for missing teacher, missing hours and missing active weeks.';
