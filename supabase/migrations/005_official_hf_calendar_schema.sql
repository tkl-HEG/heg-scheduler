-- Official hovedforloeb calendar support.
-- These tables hold the official Excel calendar before entries are converted
-- into locked lesson_bookings.

create table public.official_hf_calendar_imports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  data_import_id uuid references public.data_imports(id) on delete set null,
  filename text not null,
  calendar_year_start integer not null check (calendar_year_start between 1900 and 2200),
  calendar_year_end integer not null check (calendar_year_end between 1900 and 2200),
  source_note text,
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, school_id),
  unique (school_id, filename, calendar_year_start, calendar_year_end),
  check (calendar_year_end >= calendar_year_start)
);

create index official_hf_calendar_imports_school_id_idx
  on public.official_hf_calendar_imports(school_id);
create index official_hf_calendar_imports_data_import_id_idx
  on public.official_hf_calendar_imports(data_import_id);

create table public.official_hf_calendar_entries (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.official_hf_calendar_imports(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  calendar_year integer not null check (calendar_year between 1900 and 2200),
  sheet_name text not null,
  cell_address text not null,
  source_row integer check (source_row is null or source_row > 0),
  source_col integer check (source_col is null or source_col > 0),
  month_no smallint not null check (month_no between 1 and 12),
  month_name text not null,
  day_of_month smallint not null check (day_of_month between 1 and 31),
  date date not null,
  iso_week smallint not null check (iso_week between 1 and 53),
  weekday text,
  raw_text text not null,
  course_code text,
  course_name text,
  course_category text,
  education_program_id uuid references public.education_programs(id) on delete set null,
  class_category_id uuid references public.class_categories(id) on delete set null,
  teacher_initials text[],
  is_exam_or_project boolean not null default false,
  is_opsamling boolean not null default false,
  is_reserved_or_blocked boolean not null default false,
  lock_level text not null default 'official',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (import_id, school_id) references public.official_hf_calendar_imports(id, school_id) on delete cascade,
  unique (import_id, sheet_name, cell_address, raw_text),
  check (length(trim(sheet_name)) > 0),
  check (length(trim(cell_address)) > 0),
  check (length(trim(raw_text)) > 0),
  check (length(trim(lock_level)) > 0)
);

create index official_hf_calendar_entries_school_id_idx
  on public.official_hf_calendar_entries(school_id);
create index official_hf_calendar_entries_date_idx
  on public.official_hf_calendar_entries(school_id, date);
create index official_hf_calendar_entries_iso_week_idx
  on public.official_hf_calendar_entries(school_id, calendar_year, iso_week);
create index official_hf_calendar_entries_course_category_idx
  on public.official_hf_calendar_entries(school_id, course_category);
create index official_hf_calendar_entries_education_program_id_idx
  on public.official_hf_calendar_entries(education_program_id);
create index official_hf_calendar_entries_class_category_id_idx
  on public.official_hf_calendar_entries(class_category_id);
create index official_hf_calendar_entries_import_id_idx
  on public.official_hf_calendar_entries(import_id);

alter table public.lesson_bookings
  add column if not exists official_hf_calendar_entry_id uuid
  references public.official_hf_calendar_entries(id) on delete set null;

create index if not exists lesson_bookings_official_hf_calendar_entry_id_idx
  on public.lesson_bookings(official_hf_calendar_entry_id);

alter table public.official_hf_calendar_imports enable row level security;
alter table public.official_hf_calendar_entries enable row level security;

create policy official_hf_calendar_imports_read on public.official_hf_calendar_imports
for select using (public.user_can_read_school(school_id));

create policy official_hf_calendar_imports_write on public.official_hf_calendar_imports
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy official_hf_calendar_entries_read on public.official_hf_calendar_entries
for select using (public.user_can_read_school(school_id));

create policy official_hf_calendar_entries_write on public.official_hf_calendar_entries
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create or replace view public.v_official_hf_calendar_by_week
with (security_invoker = true)
as
select
  entry.school_id,
  entry.import_id,
  entry.calendar_year,
  entry.iso_week,
  date_trunc('week', entry.date::timestamp)::date as week_start,
  (date_trunc('week', entry.date::timestamp)::date + 6) as week_end,
  entry.date,
  entry.weekday,
  entry.sheet_name,
  entry.cell_address,
  entry.month_no,
  entry.month_name,
  entry.day_of_month,
  entry.raw_text,
  entry.course_code,
  entry.course_name,
  entry.course_category,
  entry.education_program_id,
  program.name as education_program_name,
  entry.class_category_id,
  category.name as class_category_name,
  entry.teacher_initials,
  entry.is_exam_or_project,
  entry.is_opsamling,
  entry.is_reserved_or_blocked,
  entry.lock_level
from public.official_hf_calendar_entries entry
left join public.education_programs program
  on program.id = entry.education_program_id
left join public.class_categories category
  on category.id = entry.class_category_id;

create or replace view public.v_official_hf_calendar_unmatched
with (security_invoker = true)
as
select
  entry.id as entry_id,
  entry.school_id,
  entry.import_id,
  entry.calendar_year,
  entry.sheet_name,
  entry.cell_address,
  entry.source_row,
  entry.source_col,
  entry.date,
  entry.iso_week,
  entry.raw_text,
  entry.course_code,
  entry.course_name,
  entry.course_category,
  entry.education_program_id,
  entry.class_category_id,
  array_remove(array[
    case when entry.course_code is null or entry.course_name is null then 'missing_course' end,
    case when entry.course_category is null then 'missing_course_category' end,
    case when entry.education_program_id is null then 'missing_education_program' end,
    case when entry.class_category_id is null then 'missing_class_category' end
  ], null::text)::text[] as unmatched_reasons
from public.official_hf_calendar_entries entry
where entry.course_code is null
   or entry.course_name is null
   or entry.course_category is null
   or entry.education_program_id is null
   or entry.class_category_id is null;

create or replace view public.v_official_hf_calendar_teacher_load
with (security_invoker = true)
as
select
  entry.school_id,
  entry.import_id,
  entry.calendar_year,
  entry.iso_week,
  teacher_initial as teacher_initials,
  count(*)::integer as entry_count,
  count(distinct entry.date)::integer as teaching_days,
  min(entry.date) as first_date,
  max(entry.date) as last_date,
  array_agg(distinct entry.course_category) filter (where entry.course_category is not null) as course_categories,
  array_agg(distinct entry.course_name) filter (where entry.course_name is not null) as course_names
from public.official_hf_calendar_entries entry
cross join lateral unnest(coalesce(entry.teacher_initials, array[]::text[])) as teacher_initial
group by
  entry.school_id,
  entry.import_id,
  entry.calendar_year,
  entry.iso_week,
  teacher_initial;

comment on table public.official_hf_calendar_imports is
  'One official hovedforloeb calendar workbook import. It must be loaded before normal schedule generation.';
comment on column public.official_hf_calendar_imports.data_import_id is
  'Optional link to data_imports so import_warnings can reference the same import run.';
comment on column public.official_hf_calendar_imports.filename is
  'Original workbook filename, for example Kalender 2023-2028 nyt forslag.xlsx.';
comment on column public.official_hf_calendar_imports.source_note is
  'Human note describing the official source and any parsing assumptions.';

comment on table public.official_hf_calendar_entries is
  'Structured entries from the official hovedforloeb Excel calendar.';
comment on column public.official_hf_calendar_entries.cell_address is
  'Excel cell address used with import_id to keep imports idempotent.';
comment on column public.official_hf_calendar_entries.raw_text is
  'Original text from the calendar cell before normalization.';
comment on column public.official_hf_calendar_entries.teacher_initials is
  'Teacher initials extracted from parentheses such as (JAT/TKL).';
comment on column public.official_hf_calendar_entries.lock_level is
  'Default official means entries should become locked bookings that generators plan around.';
comment on column public.lesson_bookings.official_hf_calendar_entry_id is
  'Trace link from a locked booking back to the official hovedforloeb calendar entry.';
comment on view public.v_official_hf_calendar_by_week is
  'Official hovedforloeb calendar entries grouped with week context.';
comment on view public.v_official_hf_calendar_unmatched is
  'Official calendar entries that still need matching to course, category or education programme.';
comment on view public.v_official_hf_calendar_teacher_load is
  'Teacher load derived from official hovedforloeb calendar teacher initials.';
