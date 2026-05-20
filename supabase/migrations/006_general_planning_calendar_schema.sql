-- General planning calendar support for GF1, GF2, STAA and important dates.
-- These events guide scheduling as blockers, warnings and milestones.
-- They are not lesson_bookings and must not be converted automatically.

create table public.planning_calendar_imports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  data_import_id uuid references public.data_imports(id) on delete set null,
  filename text not null,
  source_type text not null,
  period_label text,
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, school_id),
  unique (school_id, filename, source_type),
  check (length(trim(filename)) > 0),
  check (length(trim(source_type)) > 0)
);

create index planning_calendar_imports_school_id_idx
  on public.planning_calendar_imports(school_id);
create index planning_calendar_imports_data_import_id_idx
  on public.planning_calendar_imports(data_import_id);
create index planning_calendar_imports_source_type_idx
  on public.planning_calendar_imports(school_id, source_type);

create table public.planning_calendar_events (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.planning_calendar_imports(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  source_type text not null,
  source_file text,
  source_sheet text,
  source_row integer check (source_row is null or source_row > 0),
  source_col integer check (source_col is null or source_col > 0),
  cell_address text,
  dedupe_key text not null,
  date date,
  end_date date,
  iso_week integer check (iso_week is null or iso_week between 1 and 53),
  weekday text,
  title text not null,
  raw_text text not null,
  event_type text not null,
  class_category_id uuid references public.class_categories(id) on delete set null,
  education_program_id uuid references public.education_programs(id) on delete set null,
  class_group_id uuid references public.class_groups(id) on delete set null,
  applies_to text[],
  teacher_initials text[],
  lock_level text not null default 'info',
  affects_scheduling boolean not null default true,
  should_create_booking boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (import_id, school_id) references public.planning_calendar_imports(id, school_id) on delete cascade,
  unique (import_id, dedupe_key),
  check (end_date is null or date is null or end_date >= date),
  check (length(trim(source_type)) > 0),
  check (length(trim(dedupe_key)) > 0),
  check (length(trim(title)) > 0),
  check (length(trim(raw_text)) > 0),
  check (length(trim(event_type)) > 0),
  check (lock_level in ('info', 'warning', 'soft_block', 'hard_block'))
);

create index planning_calendar_events_school_id_idx
  on public.planning_calendar_events(school_id);
create index planning_calendar_events_date_idx
  on public.planning_calendar_events(school_id, date);
create index planning_calendar_events_iso_week_idx
  on public.planning_calendar_events(school_id, iso_week);
create index planning_calendar_events_source_type_idx
  on public.planning_calendar_events(school_id, source_type);
create index planning_calendar_events_event_type_idx
  on public.planning_calendar_events(school_id, event_type);
create index planning_calendar_events_lock_level_idx
  on public.planning_calendar_events(school_id, lock_level);
create index planning_calendar_events_class_category_id_idx
  on public.planning_calendar_events(class_category_id);
create index planning_calendar_events_education_program_id_idx
  on public.planning_calendar_events(education_program_id);
create index planning_calendar_events_import_id_idx
  on public.planning_calendar_events(import_id);

create table public.planning_calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  planning_calendar_event_id uuid not null references public.planning_calendar_events(id) on delete cascade,
  lesson_booking_id uuid not null references public.lesson_bookings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (planning_calendar_event_id, lesson_booking_id)
);

create index planning_calendar_event_links_event_id_idx
  on public.planning_calendar_event_links(planning_calendar_event_id);
create index planning_calendar_event_links_lesson_booking_id_idx
  on public.planning_calendar_event_links(lesson_booking_id);

alter table public.planning_calendar_imports enable row level security;
alter table public.planning_calendar_events enable row level security;
alter table public.planning_calendar_event_links enable row level security;

create policy planning_calendar_imports_read on public.planning_calendar_imports
for select using (public.user_can_read_school(school_id));

create policy planning_calendar_imports_write on public.planning_calendar_imports
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy planning_calendar_events_read on public.planning_calendar_events
for select using (public.user_can_read_school(school_id));

create policy planning_calendar_events_write on public.planning_calendar_events
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy planning_calendar_event_links_read on public.planning_calendar_event_links
for select using (
  exists (
    select 1
    from public.planning_calendar_events event
    where event.id = planning_calendar_event_id
      and public.user_can_read_school(event.school_id)
  )
);

create policy planning_calendar_event_links_write on public.planning_calendar_event_links
for all using (
  exists (
    select 1
    from public.planning_calendar_events event
    where event.id = planning_calendar_event_id
      and public.user_can_write_school(event.school_id)
  )
)
with check (
  exists (
    select 1
    from public.planning_calendar_events event
    where event.id = planning_calendar_event_id
      and public.user_can_write_school(event.school_id)
  )
);

create or replace view public.v_planning_calendar_by_week
with (security_invoker = true)
as
select
  event.school_id,
  extract(isoyear from event.date)::integer as iso_year,
  event.iso_week,
  min(event.date) as first_date,
  max(coalesce(event.end_date, event.date)) as last_date,
  event.source_type,
  event.event_type,
  event.lock_level,
  event.class_category_id,
  category.name as class_category_name,
  event.education_program_id,
  program.name as education_program_name,
  count(*)::integer as event_count,
  array_agg(event.title order by event.date, event.title) as titles
from public.planning_calendar_events event
left join public.class_categories category
  on category.id = event.class_category_id
left join public.education_programs program
  on program.id = event.education_program_id
where event.date is not null
group by
  event.school_id,
  extract(isoyear from event.date),
  event.iso_week,
  event.source_type,
  event.event_type,
  event.lock_level,
  event.class_category_id,
  category.name,
  event.education_program_id,
  program.name;

create or replace view public.v_planning_calendar_blockers
with (security_invoker = true)
as
select
  event.*,
  category.name as class_category_name,
  program.name as education_program_name
from public.planning_calendar_events event
left join public.class_categories category
  on category.id = event.class_category_id
left join public.education_programs program
  on program.id = event.education_program_id
where event.lock_level in ('soft_block', 'hard_block');

create or replace view public.v_planning_calendar_deadlines
with (security_invoker = true)
as
select
  event.*,
  category.name as class_category_name,
  program.name as education_program_name
from public.planning_calendar_events event
left join public.class_categories category
  on category.id = event.class_category_id
left join public.education_programs program
  on program.id = event.education_program_id
where event.event_type in (
  'deadline',
  'grade_deadline',
  'publication',
  'eop',
  'eo_assignment',
  'exam',
  'terminsproeve'
);

create or replace view public.v_planning_calendar_unmatched
with (security_invoker = true)
as
select
  event.id as event_id,
  event.school_id,
  event.import_id,
  event.source_type,
  event.source_file,
  event.source_sheet,
  event.source_row,
  event.source_col,
  event.cell_address,
  event.date,
  event.iso_week,
  event.title,
  event.raw_text,
  event.event_type,
  event.applies_to,
  event.class_category_id,
  event.education_program_id,
  event.metadata,
  array_remove(array[
    case when event.event_type = 'unknown' then 'unknown_event_type' end,
    case when event.class_category_id is null and not ('Alle' = any(coalesce(event.applies_to, array[]::text[]))) then 'missing_class_category' end,
    case when event.education_program_id is null and not ('Alle' = any(coalesce(event.applies_to, array[]::text[]))) then 'missing_education_program' end
  ], null::text)::text[] as unmatched_reasons
from public.planning_calendar_events event
where event.event_type = 'unknown'
   or (
     (event.class_category_id is null or event.education_program_id is null)
     and not ('Alle' = any(coalesce(event.applies_to, array[]::text[])))
   );

comment on table public.planning_calendar_imports is
  'One general planning-calendar import for GF1, GF2, STAA or important dates.';
comment on column public.planning_calendar_imports.source_type is
  'Source family such as gf1_calendar, gf2_calendar, staa_calendar or important_dates_docx.';
comment on column public.planning_calendar_imports.period_label is
  'Human period label, for example Efteraar 2026.';

comment on table public.planning_calendar_events is
  'Planning events that influence schedule generation as information, warnings or blockers without becoming bookings automatically.';
comment on column public.planning_calendar_events.dedupe_key is
  'Stable parser key used with import_id to keep repeated imports idempotent.';
comment on column public.planning_calendar_events.event_type is
  'Normalized event type such as exam, praktik, usf, deadline or info.';
comment on column public.planning_calendar_events.lock_level is
  'Scheduling impact: info, warning, soft_block or hard_block.';
comment on column public.planning_calendar_events.should_create_booking is
  'Always false on import; later review workflows may decide whether an event should become a lesson booking.';
comment on column public.planning_calendar_events.applies_to is
  'Free-text scope hints such as GF1, GF2, STAA or Alle.';

comment on table public.planning_calendar_event_links is
  'Future trace links from reviewed planning-calendar events to concrete lesson bookings.';
comment on view public.v_planning_calendar_by_week is
  'General planning calendar events summarized by week, source, type and category.';
comment on view public.v_planning_calendar_blockers is
  'Planning calendar events that block or strongly influence scheduling.';
comment on view public.v_planning_calendar_deadlines is
  'Planning calendar deadlines, publications, EOP/EO milestones and exam-related dates.';
comment on view public.v_planning_calendar_unmatched is
  'Planning calendar events that still need type, category or programme review.';
