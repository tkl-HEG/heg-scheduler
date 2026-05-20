-- Teacher workload planning layer.
-- Opgaveoversigt is annual, while fagfordeling and scheduling are planned
-- by half-year periods. This migration adds the planning structure only:
-- no lesson_bookings, no generator and no anon write access.

create table if not exists public.workload_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  label text not null,
  starts_on date not null,
  ends_on date not null,
  is_active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (length(trim(label)) > 0),
  check (ends_on >= starts_on),
  unique (school_id, label)
);

create index if not exists workload_years_school_id_idx
  on public.workload_years(school_id);
create index if not exists workload_years_active_idx
  on public.workload_years(school_id, is_active);

create table if not exists public.teacher_workload_allocations (
  id uuid primary key default gen_random_uuid(),
  workload_year_id uuid not null references public.workload_years(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  allocated_hours numeric(8, 2) not null check (allocated_hours >= 0),
  teaching_hours_target numeric(8, 2) check (teaching_hours_target is null or teaching_hours_target >= 0),
  non_teaching_hours numeric(8, 2) check (non_teaching_hours is null or non_teaching_hours >= 0),
  notes text,
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workload_year_id, teacher_id),
  check (length(trim(source)) > 0)
);

create index if not exists teacher_workload_allocations_year_idx
  on public.teacher_workload_allocations(workload_year_id);
create index if not exists teacher_workload_allocations_teacher_idx
  on public.teacher_workload_allocations(teacher_id);

drop trigger if exists teacher_workload_allocations_set_updated_at on public.teacher_workload_allocations;
create trigger teacher_workload_allocations_set_updated_at
before update on public.teacher_workload_allocations
for each row execute function public.set_updated_at();

create table if not exists public.workload_periods (
  id uuid primary key default gen_random_uuid(),
  workload_year_id uuid not null references public.workload_years(id) on delete cascade,
  label text not null,
  period_type text not null default 'half_year',
  starts_on date not null,
  ends_on date not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workload_year_id, label),
  check (length(trim(label)) > 0),
  check (length(trim(period_type)) > 0),
  check (ends_on >= starts_on)
);

create index if not exists workload_periods_year_idx
  on public.workload_periods(workload_year_id);
create index if not exists workload_periods_dates_idx
  on public.workload_periods(starts_on, ends_on);

alter table public.workload_years enable row level security;
alter table public.teacher_workload_allocations enable row level security;
alter table public.workload_periods enable row level security;

drop policy if exists workload_years_read on public.workload_years;
create policy workload_years_read on public.workload_years
for select using (public.user_can_read_school(school_id));

drop policy if exists workload_years_write on public.workload_years;
create policy workload_years_write on public.workload_years
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

drop policy if exists teacher_workload_allocations_read on public.teacher_workload_allocations;
create policy teacher_workload_allocations_read on public.teacher_workload_allocations
for select using (
  exists (
    select 1
    from public.workload_years workload_year
    where workload_year.id = workload_year_id
      and public.user_can_read_school(workload_year.school_id)
  )
);

drop policy if exists teacher_workload_allocations_write on public.teacher_workload_allocations;
create policy teacher_workload_allocations_write on public.teacher_workload_allocations
for all using (
  exists (
    select 1
    from public.workload_years workload_year
    where workload_year.id = workload_year_id
      and public.user_can_write_school(workload_year.school_id)
  )
)
with check (
  exists (
    select 1
    from public.workload_years workload_year
    where workload_year.id = workload_year_id
      and public.user_can_write_school(workload_year.school_id)
  )
);

drop policy if exists workload_periods_read on public.workload_periods;
create policy workload_periods_read on public.workload_periods
for select using (
  exists (
    select 1
    from public.workload_years workload_year
    where workload_year.id = workload_year_id
      and public.user_can_read_school(workload_year.school_id)
  )
);

drop policy if exists workload_periods_write on public.workload_periods;
create policy workload_periods_write on public.workload_periods
for all using (
  exists (
    select 1
    from public.workload_years workload_year
    where workload_year.id = workload_year_id
      and public.user_can_write_school(workload_year.school_id)
  )
)
with check (
  exists (
    select 1
    from public.workload_years workload_year
    where workload_year.id = workload_year_id
      and public.user_can_write_school(workload_year.school_id)
  )
);

create or replace view public.v_teacher_workload_status
with (security_invoker = true)
as
with assignment_hours as (
  select
    assignment.teacher_id,
    sum(
      case
        when offering.hours_missing or offering.total_hours <= 0 then 0
        else offering.total_hours * coalesce(assignment.share_fraction, 1)
      end
    ) as assigned_hours_known,
    count(*) filter (
      where offering.hours_missing or offering.total_hours <= 0
    ) as assigned_hours_missing
  from public.teaching_assignments assignment
  join public.subject_offerings offering
    on offering.id = assignment.subject_offering_id
  group by assignment.teacher_id
),
status_input as (
  select
    workload_year.school_id,
    workload_year.id as workload_year_id,
    workload_year.label as workload_year_label,
    teacher.id as teacher_id,
    teacher.initials,
    teacher.display_name,
    (
      coalesce((teacher.metadata ->> 'is_pseudo_teacher')::boolean, false)
      or coalesce((teacher.metadata ->> 'is_resource')::boolean, false)
    ) as is_pseudo_resource,
    allocation.allocated_hours,
    allocation.teaching_hours_target,
    allocation.non_teaching_hours,
    case
      when (
        coalesce((teacher.metadata ->> 'is_pseudo_teacher')::boolean, false)
        or coalesce((teacher.metadata ->> 'is_resource')::boolean, false)
      ) then 0::numeric
      else coalesce(assignment_hours.assigned_hours_known, 0)
    end as assigned_hours_known,
    case
      when (
        coalesce((teacher.metadata ->> 'is_pseudo_teacher')::boolean, false)
        or coalesce((teacher.metadata ->> 'is_resource')::boolean, false)
      ) then 0
      else coalesce(assignment_hours.assigned_hours_missing, 0)
    end as assigned_hours_missing
  from public.workload_years workload_year
  join public.teachers teacher
    on teacher.school_id = workload_year.school_id
  left join public.teacher_workload_allocations allocation
    on allocation.workload_year_id = workload_year.id
   and allocation.teacher_id = teacher.id
  left join assignment_hours
    on assignment_hours.teacher_id = teacher.id
)
select
  school_id,
  workload_year_id,
  workload_year_label,
  teacher_id,
  initials,
  display_name,
  is_pseudo_resource,
  allocated_hours,
  teaching_hours_target,
  non_teaching_hours,
  assigned_hours_known,
  assigned_hours_missing,
  case
    when is_pseudo_resource or allocated_hours is null then null
    else allocated_hours - assigned_hours_known
  end as remaining_hours,
  case
    when is_pseudo_resource then 'pseudo_resource_not_counted'
    when allocated_hours is null then 'missing_allocation'
    when assigned_hours_missing > 0 then 'missing_assignment_hours'
    when allocated_hours - assigned_hours_known < 0 then 'over_allocated'
    when allocated_hours - assigned_hours_known > 0 then 'under_allocated'
    else 'on_target'
  end as status
from status_input;

comment on table public.workload_years is
  'Annual workload planning years. Opgaveoversigt is planned yearly before half-year fagfordeling and scheduling.';
comment on table public.teacher_workload_allocations is
  'Annual teacher workload allocation per teacher. LSSS/self-study resources should not be counted as ordinary teacher workload.';
comment on table public.workload_periods is
  'Half-year periods inside a workload year, used later for fagfordeling and scheduling.';
comment on view public.v_teacher_workload_status is
  'Read-only workload status view comparing annual allocation with known assigned subject offering hours. This is preliminary and not a scheduler.';
comment on column public.teacher_workload_allocations.allocated_hours is
  'Annual allocated workload hours from opgaveoversigten.';
comment on column public.teacher_workload_allocations.teaching_hours_target is
  'Optional target for teaching-related hours within the annual allocation.';
comment on column public.teacher_workload_allocations.non_teaching_hours is
  'Optional non-teaching hours, for example coordination, projects or other duties.';

do $$
declare
  v_school_id uuid;
  v_workload_year_id uuid;
begin
  select school.id
    into v_school_id
  from public.schools school
  join public.organizations organization
    on organization.id = school.organization_id
  where organization.slug = 'heg'
    and school.slug = 'heg'
  order by school.created_at, school.id
  limit 1;

  if v_school_id is null then
    select school.id
      into v_school_id
    from public.schools school
    join public.organizations organization
      on organization.id = school.organization_id
    where organization.name = 'HEG / Skole'
      and school.name = 'HEG'
    order by school.created_at, school.id
    limit 1;
  end if;

  if v_school_id is null then
    raise exception 'Cannot seed workload year 2026/2027: HEG school was not found. Run migrations 003 and 004 first.';
  end if;

  insert into public.workload_years (
    school_id,
    label,
    starts_on,
    ends_on,
    is_active,
    metadata
  )
  values (
    v_school_id,
    '2026/2027',
    '2026-08-01'::date,
    '2027-07-31'::date,
    true,
    jsonb_build_object(
      'source', 'migration_010',
      'note', 'Seeded planning year for annual opgaveoversigt.'
    )
  )
  on conflict (school_id, label) do update
  set
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    is_active = excluded.is_active,
    metadata = public.workload_years.metadata || excluded.metadata
  returning id into v_workload_year_id;

  insert into public.workload_periods (
    workload_year_id,
    label,
    period_type,
    starts_on,
    ends_on,
    metadata
  )
  values
    (
      v_workload_year_id,
      'Efterår 2026',
      'half_year',
      '2026-08-01'::date,
      '2026-12-31'::date,
      jsonb_build_object('source', 'migration_010', 'term', 'H2')
    ),
    (
      v_workload_year_id,
      'Forår 2027',
      'half_year',
      '2027-01-01'::date,
      '2027-07-31'::date,
      jsonb_build_object('source', 'migration_010', 'term', 'H1')
    )
  on conflict (workload_year_id, label) do update
  set
    period_type = excluded.period_type,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    metadata = public.workload_periods.metadata || excluded.metadata;
end $$;
