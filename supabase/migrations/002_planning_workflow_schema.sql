-- Scheduler v2 planning workflow extension.
-- This migration keeps 001 intact and adds the workflow concepts needed for
-- category-based planning, education requirements, module planning and
-- schedule generation runs.

alter type public.competency_level add value if not exists 'certified';

do $$
begin
  create type public.class_category_level as enum ('main', 'subcategory');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.schedule_generation_status as enum ('pending', 'running', 'completed', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.schedule_generation_scope_type as enum ('class', 'category', 'multiple_categories', 'all');
exception when duplicate_object then null;
end $$;

create table public.room_types (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  code citext not null,
  name text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, code)
);

create index room_types_school_id_idx on public.room_types(school_id);

create trigger room_types_set_updated_at
before update on public.room_types
for each row execute function public.set_updated_at();

create table public.class_categories (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  parent_id uuid references public.class_categories(id) on delete restrict,
  category_level public.class_category_level not null default 'subcategory',
  name text not null,
  normalized_key text,
  sort_order integer,
  planning_profile jsonb not null default '{}'::jsonb,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create unique index class_categories_school_root_key
on public.class_categories(school_id, coalesce(normalized_key, lower(name)))
where parent_id is null;

create unique index class_categories_school_parent_key
on public.class_categories(school_id, parent_id, coalesce(normalized_key, lower(name)))
where parent_id is not null;

create index class_categories_school_id_idx on public.class_categories(school_id);
create index class_categories_parent_id_idx on public.class_categories(parent_id);

create trigger class_categories_set_updated_at
before update on public.class_categories
for each row execute function public.set_updated_at();

create table public.education_programs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  code citext not null,
  name text not null,
  description text,
  default_class_category_id uuid references public.class_categories(id) on delete set null,
  default_period_value integer check (default_period_value is null or default_period_value > 0),
  default_period_unit public.period_unit,
  planning_defaults jsonb not null default '{}'::jsonb,
  notes text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, code)
);

create index education_programs_school_id_idx on public.education_programs(school_id);
create index education_programs_default_class_category_id_idx on public.education_programs(default_class_category_id);

create trigger education_programs_set_updated_at
before update on public.education_programs
for each row execute function public.set_updated_at();

alter table public.rooms
  add column if not exists room_type_id uuid references public.room_types(id) on delete set null;

create index if not exists rooms_room_type_id_idx on public.rooms(room_type_id);

alter table public.class_groups
  add column if not exists class_category_id uuid references public.class_categories(id) on delete set null,
  add column if not exists education_program_id uuid references public.education_programs(id) on delete set null,
  add column if not exists planning_notes text,
  add column if not exists scheduling_notes text;

create index if not exists class_groups_class_category_id_idx on public.class_groups(class_category_id);
create index if not exists class_groups_education_program_id_idx on public.class_groups(education_program_id);

create table public.education_requirements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  education_program_id uuid not null references public.education_programs(id) on delete cascade,
  class_category_id uuid references public.class_categories(id) on delete cascade,
  class_group_id uuid references public.class_groups(id) on delete cascade,
  course_subject_id uuid not null references public.course_subjects(id) on delete restrict,
  total_hours numeric(7, 2) check (total_hours is null or total_hours >= 0),
  weekly_hours numeric(6, 2) check (weekly_hours is null or weekly_hours >= 0),
  required_weeks integer[],
  min_modules_per_week integer check (min_modules_per_week is null or min_modules_per_week >= 0),
  max_modules_per_week integer check (max_modules_per_week is null or max_modules_per_week >= 0),
  preferred_module_type text,
  preferred_room_type text,
  requires_primary_competency boolean not null default false,
  requires_certified_competency boolean not null default false,
  priority public.subject_priority not null default 'medium',
  notes text,
  source_import_id uuid references public.data_imports(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    max_modules_per_week is null
    or min_modules_per_week is null
    or max_modules_per_week >= min_modules_per_week
  )
);

create index education_requirements_school_id_idx on public.education_requirements(school_id);
create index education_requirements_education_program_id_idx on public.education_requirements(education_program_id);
create index education_requirements_class_category_id_idx on public.education_requirements(class_category_id);
create index education_requirements_class_group_id_idx on public.education_requirements(class_group_id);
create index education_requirements_course_subject_id_idx on public.education_requirements(course_subject_id);

create trigger education_requirements_set_updated_at
before update on public.education_requirements
for each row execute function public.set_updated_at();

create table public.time_modules (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  module_no smallint not null check (module_no > 0),
  name text not null,
  module_type text not null,
  sort_order smallint not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, module_no),
  unique (id, school_id),
  check (length(trim(module_type)) > 0)
);

create index time_modules_school_id_idx on public.time_modules(school_id);
create index time_modules_module_type_idx on public.time_modules(school_id, module_type);

create trigger time_modules_set_updated_at
before update on public.time_modules
for each row execute function public.set_updated_at();

create table public.time_module_blocks (
  time_module_id uuid not null,
  school_id uuid not null,
  block_no smallint not null,
  sort_order smallint,
  primary key (time_module_id, block_no),
  foreign key (time_module_id, school_id) references public.time_modules(id, school_id) on delete cascade,
  foreign key (school_id, block_no) references public.school_blocks(school_id, block_no) on delete cascade
);

create index time_module_blocks_school_block_idx on public.time_module_blocks(school_id, block_no);

create table public.schedule_generation_runs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text,
  status public.schedule_generation_status not null default 'pending',
  scope_type public.schedule_generation_scope_type not null,
  scope jsonb not null default '{}'::jsonb,
  parameters jsonb not null default '{}'::jsonb,
  input_summary jsonb not null default '{}'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, school_id)
);

create index schedule_generation_runs_school_id_idx on public.schedule_generation_runs(school_id);
create index schedule_generation_runs_status_idx on public.schedule_generation_runs(school_id, status);
create index schedule_generation_runs_scope_type_idx on public.schedule_generation_runs(school_id, scope_type);

alter table public.lesson_bookings
  add column if not exists time_module_id uuid references public.time_modules(id) on delete set null,
  add column if not exists locked boolean not null default false,
  add column if not exists source text not null default 'manual',
  add column if not exists generation_run_id uuid references public.schedule_generation_runs(id) on delete set null;

alter table public.lesson_bookings
  add constraint lesson_bookings_source_not_blank check (length(trim(source)) > 0);

create index if not exists lesson_bookings_time_module_id_idx on public.lesson_bookings(time_module_id);
create index if not exists lesson_bookings_generation_run_id_idx on public.lesson_bookings(generation_run_id);
create index if not exists lesson_bookings_locked_idx on public.lesson_bookings(school_id, locked);

create table public.schedule_generation_suggestions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  generation_run_id uuid not null,
  subject_offering_id uuid not null references public.subject_offerings(id) on delete cascade,
  class_group_id uuid not null references public.class_groups(id) on delete cascade,
  teacher_id uuid references public.teachers(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  week_no smallint not null check (week_no between 1 and 80),
  day_of_week smallint not null,
  block_no smallint not null,
  time_module_id uuid references public.time_modules(id) on delete set null,
  score numeric(9, 4),
  explanation text,
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (generation_run_id, school_id) references public.schedule_generation_runs(id, school_id) on delete cascade,
  foreign key (school_id, day_of_week) references public.school_weekdays(school_id, day_of_week) on delete restrict,
  foreign key (school_id, block_no) references public.school_blocks(school_id, block_no) on delete restrict
);

create index schedule_generation_suggestions_run_id_idx on public.schedule_generation_suggestions(generation_run_id);
create index schedule_generation_suggestions_school_slot_idx
  on public.schedule_generation_suggestions(school_id, week_no, day_of_week, block_no);
create index schedule_generation_suggestions_subject_offering_id_idx
  on public.schedule_generation_suggestions(subject_offering_id);
create index schedule_generation_suggestions_class_group_id_idx
  on public.schedule_generation_suggestions(class_group_id);
create index schedule_generation_suggestions_accepted_idx
  on public.schedule_generation_suggestions(school_id, accepted);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'data_imports_id_school_id_key'
      and conrelid = 'public.data_imports'::regclass
  ) then
    alter table public.data_imports
      add constraint data_imports_id_school_id_key unique (id, school_id);
  end if;
end $$;

create table public.import_warnings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  data_import_id uuid not null,
  warning_type text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'error')),
  source_sheet text,
  source_row integer check (source_row is null or source_row > 0),
  entity_type text,
  entity_legacy_id text,
  message text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (data_import_id, school_id) references public.data_imports(id, school_id) on delete cascade,
  check (length(trim(warning_type)) > 0),
  check (length(trim(message)) > 0)
);

create index import_warnings_school_id_idx on public.import_warnings(school_id);
create index import_warnings_data_import_id_idx on public.import_warnings(data_import_id);
create index import_warnings_unresolved_idx on public.import_warnings(school_id, resolved, severity);

alter table public.room_types enable row level security;
alter table public.class_categories enable row level security;
alter table public.education_programs enable row level security;
alter table public.education_requirements enable row level security;
alter table public.time_modules enable row level security;
alter table public.time_module_blocks enable row level security;
alter table public.schedule_generation_runs enable row level security;
alter table public.schedule_generation_suggestions enable row level security;
alter table public.import_warnings enable row level security;

create policy room_types_read on public.room_types
for select using (public.user_can_read_school(school_id));

create policy room_types_write on public.room_types
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy class_categories_read on public.class_categories
for select using (public.user_can_read_school(school_id));

create policy class_categories_write on public.class_categories
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy education_programs_read on public.education_programs
for select using (public.user_can_read_school(school_id));

create policy education_programs_write on public.education_programs
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy education_requirements_read on public.education_requirements
for select using (public.user_can_read_school(school_id));

create policy education_requirements_write on public.education_requirements
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy time_modules_read on public.time_modules
for select using (public.user_can_read_school(school_id));

create policy time_modules_write on public.time_modules
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy time_module_blocks_read on public.time_module_blocks
for select using (public.user_can_read_school(school_id));

create policy time_module_blocks_write on public.time_module_blocks
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy schedule_generation_runs_read on public.schedule_generation_runs
for select using (public.user_can_read_school(school_id));

create policy schedule_generation_runs_write on public.schedule_generation_runs
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy schedule_generation_suggestions_read on public.schedule_generation_suggestions
for select using (public.user_can_read_school(school_id));

create policy schedule_generation_suggestions_write on public.schedule_generation_suggestions
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

create policy import_warnings_read on public.import_warnings
for select using (public.user_can_read_school(school_id));

create policy import_warnings_write on public.import_warnings
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

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
  room.campus_id as room_campus_id,
  booking.time_module_id,
  time_module.module_no,
  time_module.name as time_module_name,
  time_module.module_type,
  booking.locked,
  booking.source as booking_source,
  booking.generation_run_id
from public.lesson_bookings booking
join public.subject_offerings offering
  on offering.id = booking.subject_offering_id
join public.class_groups class_group
  on class_group.id = offering.class_group_id
join public.rooms room
  on room.id = booking.room_id
left join public.time_modules time_module
  on time_module.id = booking.time_module_id;

create or replace view public.v_requirement_status
with (security_invoker = true)
as
with requirement_targets as (
  select
    requirement.id as education_requirement_id,
    requirement.school_id,
    requirement.education_program_id,
    requirement.class_category_id,
    requirement.class_group_id as explicit_class_group_id,
    target_class.id as class_group_id,
    target_class.name as class_group_name,
    requirement.course_subject_id,
    requirement.total_hours,
    requirement.weekly_hours,
    requirement.required_weeks,
    requirement.min_modules_per_week,
    requirement.max_modules_per_week,
    requirement.preferred_module_type,
    requirement.preferred_room_type,
    requirement.requires_primary_competency,
    requirement.requires_certified_competency,
    requirement.priority,
    requirement.notes
  from public.education_requirements requirement
  join public.class_groups target_class
    on target_class.school_id = requirement.school_id
   and (
      (
        requirement.class_group_id is not null
        and target_class.id = requirement.class_group_id
      )
      or (
        requirement.class_group_id is null
        and requirement.class_category_id is not null
        and target_class.class_category_id = requirement.class_category_id
        and target_class.education_program_id = requirement.education_program_id
      )
      or (
        requirement.class_group_id is null
        and requirement.class_category_id is null
        and target_class.education_program_id = requirement.education_program_id
      )
    )
)
select
  target.education_requirement_id,
  target.school_id,
  target.education_program_id,
  program.name as education_program_name,
  target.class_category_id,
  category.name as class_category_name,
  target.class_group_id,
  target.class_group_name,
  target.course_subject_id,
  course_subject.name as course_subject_name,
  offering.id as subject_offering_id,
  target.total_hours,
  target.weekly_hours,
  target.required_weeks,
  target.min_modules_per_week,
  target.max_modules_per_week,
  target.preferred_module_type,
  target.preferred_room_type,
  target.requires_primary_competency,
  target.requires_certified_competency,
  target.priority,
  coalesce(assignment_stats.assignment_count, 0) as assignment_count,
  coalesce(assignment_stats.competent_assignment_count, 0) as competent_assignment_count,
  (target.total_hours is null or target.total_hours <= 0) as missing_total_hours,
  (offering.id is null) as missing_subject_offering,
  (offering.id is not null and coalesce(assignment_stats.assignment_count, 0) = 0) as missing_teaching_assignment,
  (
    offering.id is not null
    and coalesce(assignment_stats.assignment_count, 0) > 0
    and coalesce(assignment_stats.competent_assignment_count, 0) = 0
  ) as missing_teacher_competency,
  (
    target.total_hours is not null
    and target.total_hours > 0
    and offering.id is not null
    and coalesce(assignment_stats.assignment_count, 0) > 0
    and coalesce(assignment_stats.competent_assignment_count, 0) > 0
  ) as is_generation_ready
from requirement_targets target
join public.education_programs program
  on program.id = target.education_program_id
left join public.class_categories category
  on category.id = target.class_category_id
join public.course_subjects course_subject
  on course_subject.id = target.course_subject_id
left join public.subject_offerings offering
  on offering.class_group_id = target.class_group_id
 and offering.course_subject_id = target.course_subject_id
left join lateral (
  select
    count(assignment.id)::integer as assignment_count,
    count(assignment.id) filter (
      where exists (
        select 1
        from public.teacher_competencies competency
        where competency.teacher_id = assignment.teacher_id
          and competency.course_subject_id = target.course_subject_id
          and (
            (
              target.requires_certified_competency
              and competency.level::text = 'certified'
            )
            or (
              not target.requires_certified_competency
              and target.requires_primary_competency
              and competency.level::text in ('primary', 'certified')
            )
            or (
              not target.requires_certified_competency
              and not target.requires_primary_competency
              and competency.level::text in ('primary', 'secondary', 'certified')
            )
          )
      )
    )::integer as competent_assignment_count
  from public.teaching_assignments assignment
  where assignment.subject_offering_id = offering.id
) assignment_stats on true;

create or replace view public.v_class_planning_status
with (security_invoker = true)
as
with requirement_summary as (
  select
    requirement_status.school_id,
    requirement_status.class_group_id,
    count(*)::integer as requirement_count,
    count(*) filter (where requirement_status.missing_total_hours)::integer as requirements_without_hours,
    count(*) filter (where requirement_status.missing_subject_offering)::integer as requirements_without_subject_offering,
    count(*) filter (where requirement_status.missing_teaching_assignment)::integer as requirements_without_teaching_assignment,
    count(*) filter (where requirement_status.missing_teacher_competency)::integer as requirements_without_teacher_competency
  from public.v_requirement_status requirement_status
  group by requirement_status.school_id, requirement_status.class_group_id
),
subject_summary as (
  select
    offering.school_id,
    offering.class_group_id,
    count(offering.id)::integer as subject_offering_count,
    count(offering.id) filter (
      where not exists (
        select 1
        from public.teaching_assignments assignment
        where assignment.subject_offering_id = offering.id
      )
    )::integer as subject_offerings_without_assignment,
    count(offering.id) filter (
      where exists (
        select 1
        from public.teaching_assignments assignment
        where assignment.subject_offering_id = offering.id
      )
      and not exists (
        select 1
        from public.teaching_assignments assignment
        join public.teacher_competencies competency
          on competency.teacher_id = assignment.teacher_id
         and competency.course_subject_id = offering.course_subject_id
        where assignment.subject_offering_id = offering.id
      )
    )::integer as subject_offerings_without_competency
  from public.subject_offerings offering
  group by offering.school_id, offering.class_group_id
),
class_status as (
  select
    class_group.school_id,
    class_group.id as class_group_id,
    class_group.name as class_group_name,
    class_group.class_category_id,
    category.name as class_category_name,
    parent_category.id as parent_class_category_id,
    parent_category.name as parent_class_category_name,
    class_group.education_program_id,
    program.name as education_program_name,
    count(active_week.week_no)::integer as active_week_count,
    (class_group.class_category_id is null) as missing_category,
    (class_group.education_program_id is null) as missing_education_program,
    (count(active_week.week_no) = 0) as missing_active_weeks,
    coalesce(requirement_summary.requirement_count, 0) as requirement_count,
    coalesce(requirement_summary.requirements_without_hours, 0) as requirements_without_hours,
    coalesce(requirement_summary.requirements_without_subject_offering, 0) as requirements_without_subject_offering,
    coalesce(requirement_summary.requirements_without_teaching_assignment, 0) as requirements_without_teaching_assignment,
    coalesce(requirement_summary.requirements_without_teacher_competency, 0) as requirements_without_teacher_competency,
    coalesce(subject_summary.subject_offering_count, 0) as subject_offering_count,
    coalesce(subject_summary.subject_offerings_without_assignment, 0) as subject_offerings_without_assignment,
    coalesce(subject_summary.subject_offerings_without_competency, 0) as subject_offerings_without_competency
  from public.class_groups class_group
  left join public.class_categories category
    on category.id = class_group.class_category_id
  left join public.class_categories parent_category
    on parent_category.id = category.parent_id
  left join public.education_programs program
    on program.id = class_group.education_program_id
  left join public.class_active_weeks active_week
    on active_week.class_group_id = class_group.id
  left join requirement_summary
    on requirement_summary.class_group_id = class_group.id
  left join subject_summary
    on subject_summary.class_group_id = class_group.id
  group by
    class_group.school_id,
    class_group.id,
    class_group.name,
    class_group.class_category_id,
    category.name,
    parent_category.id,
    parent_category.name,
    class_group.education_program_id,
    program.name,
    requirement_summary.requirement_count,
    requirement_summary.requirements_without_hours,
    requirement_summary.requirements_without_subject_offering,
    requirement_summary.requirements_without_teaching_assignment,
    requirement_summary.requirements_without_teacher_competency,
    subject_summary.subject_offering_count,
    subject_summary.subject_offerings_without_assignment,
    subject_summary.subject_offerings_without_competency
)
select
  class_status.*,
  array_remove(array[
    case when class_status.missing_category then 'missing_category' end,
    case when class_status.missing_education_program then 'missing_education_program' end,
    case when class_status.missing_active_weeks then 'missing_active_weeks' end,
    case when class_status.requirement_count = 0 then 'missing_requirements' end,
    case when class_status.requirements_without_hours > 0 then 'requirements_missing_hours' end,
    case when class_status.requirements_without_subject_offering > 0 then 'requirements_missing_subject_offerings' end,
    case when class_status.requirements_without_teaching_assignment > 0 then 'requirements_missing_teaching_assignment' end,
    case when class_status.requirements_without_teacher_competency > 0 then 'requirements_missing_teacher_competency' end,
    case when class_status.subject_offerings_without_assignment > 0 then 'subject_offerings_missing_assignment' end,
    case when class_status.subject_offerings_without_competency > 0 then 'subject_offerings_missing_competency' end
  ], null::text)::text[] as blocking_reasons
from class_status;

create or replace view public.v_generation_ready_classes
with (security_invoker = true)
as
select
  status.school_id,
  status.class_group_id,
  status.class_group_name,
  status.class_category_id,
  status.class_category_name,
  status.parent_class_category_id,
  status.parent_class_category_name,
  status.education_program_id,
  status.education_program_name,
  status.active_week_count,
  status.requirement_count,
  status.subject_offering_count,
  status.blocking_reasons,
  (cardinality(status.blocking_reasons) = 0) as is_ready_for_generation,
  jsonb_build_object(
    'scope_type', 'class',
    'class_group_id', status.class_group_id,
    'class_category_id', status.class_category_id,
    'education_program_id', status.education_program_id
  ) as generation_scope
from public.v_class_planning_status status;

comment on table public.room_types is 'Room categories such as standard classroom, workshop or IT room.';
comment on column public.rooms.room_type_id is 'Optional normalized room type used by planning rules and education requirements.';

comment on table public.class_categories is 'Editable hierarchy for planning categories such as Grundfag, Hovedforlob, Brobygning and AMU with subcategories such as GF1, GF2, STAA1, STAA2, detail and 8. klasse.';
comment on column public.class_categories.parent_id is 'Null for main categories; points to the main category for subcategories.';
comment on column public.class_categories.planning_profile is 'Category-level generator hints, for example two different subjects per day for grundforlob.';

comment on table public.education_programs is 'Education plans or programme types used as reusable templates for class requirements.';
comment on column public.education_programs.planning_defaults is 'Default generator parameters for this programme, overridable per generation run.';

comment on column public.class_groups.class_category_id is 'Planning category for the class group.';
comment on column public.class_groups.education_program_id is 'Education programme or plan followed by the class group.';
comment on column public.class_groups.planning_notes is 'Free-text notes from holdafklaring and planning preparation.';
comment on column public.class_groups.scheduling_notes is 'Free-text notes that should influence manual scheduling or generation.';

comment on table public.education_requirements is 'Recipe for which subjects a programme/category/class must receive and how they should be planned.';
comment on column public.education_requirements.class_category_id is 'Optional category scope. When null and class_group_id is null, the requirement applies to the whole education programme.';
comment on column public.education_requirements.class_group_id is 'Optional class-specific override or additional requirement.';
comment on column public.education_requirements.required_weeks is 'Optional explicit week list for this subject requirement.';
comment on column public.education_requirements.preferred_module_type is 'Optional module preference such as morning, afternoon or full_day.';
comment on column public.education_requirements.preferred_room_type is 'Optional room type preference; should match room_types.code when normalized room types are used.';
comment on column public.education_requirements.requires_primary_competency is 'When true, secondary competency is not enough for the requirement.';
comment on column public.education_requirements.requires_certified_competency is 'When true, the teacher must have certified competency for the subject.';

comment on table public.time_modules is 'Planning modules that group blocks, for example Formiddag and Eftermiddag.';
comment on column public.time_modules.module_type is 'Free-form module type, typically morning or afternoon.';
comment on table public.time_module_blocks is 'Join table mapping modules to one or more school blocks.';

comment on column public.lesson_bookings.time_module_id is 'Optional module placement. The generator should plan modules first and derive blocks through time_module_blocks.';
comment on column public.lesson_bookings.locked is 'Locked bookings should not be moved by future generation runs.';
comment on column public.lesson_bookings.source is 'Origin of the booking, for example manual, excel, generator or accepted_suggestion.';
comment on column public.lesson_bookings.generation_run_id is 'Generation run that created or last proposed this booking.';

comment on table public.schedule_generation_runs is 'One attempt to generate a schedule for one class, one category, multiple categories or all classes.';
comment on column public.schedule_generation_runs.scope is 'JSON scope payload, for example selected class_group_ids or class_category_ids.';
comment on column public.schedule_generation_runs.parameters is 'Generator settings such as split mode, module preferences and category-specific rules.';
comment on column public.schedule_generation_runs.input_summary is 'Snapshot summary of the planning inputs used by the run.';
comment on column public.schedule_generation_runs.result_summary is 'Summary of placed, skipped, conflicting and suggested lessons.';

comment on table public.schedule_generation_suggestions is 'Uncommitted schedule proposals produced by a generation run before a user accepts them.';
comment on column public.schedule_generation_suggestions.accepted is 'True after a suggestion has been accepted and applied to lesson_bookings.';

comment on table public.import_warnings is 'Excel/prototype import warnings that need review without blocking the full import.';
comment on column public.import_warnings.resolved is 'True when the warning has been reviewed or fixed in the app.';

comment on view public.v_class_planning_status is 'Class-level readiness status: category, active weeks, requirements, assignments and competency gaps.';
comment on view public.v_requirement_status is 'Expanded requirement status per target class, including missing hours, subject offerings, fagfordeling and teacher competency.';
comment on view public.v_generation_ready_classes is 'One row per class showing whether it is ready for schedule generation and why not.';
