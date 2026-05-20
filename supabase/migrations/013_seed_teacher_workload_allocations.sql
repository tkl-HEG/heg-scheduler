-- Temporary teacher workload allocations for school year 2026/2027.
-- This is a data seed for the annual opgaveoversigt layer. It does not create
-- lesson_bookings, generator data or frontend write access.

do $$
declare
  v_workload_year_id uuid;
  v_school_id uuid;
  v_seed_metadata jsonb := '{
    "temporary": true,
    "school_year": "2026/2027",
    "created_from": "manual planning assumption"
  }'::jsonb;
begin
  select year.id, year.school_id
    into v_workload_year_id, v_school_id
  from public.workload_years year
  where year.label = '2026/2027'
  order by year.created_at, year.id
  limit 1;

  if v_workload_year_id is null then
    raise exception 'Cannot seed teacher workload allocations: workload year 2026/2027 was not found. Run migration 010 first.';
  end if;

  if not exists (
    select 1
    from public.teachers teacher
    where teacher.school_id = v_school_id
      and teacher.initials = 'CNH'
  ) then
    raise notice 'Teacher CNH was not found. No teacher was created automatically; CNH allocation was not inserted.';
  end if;

  insert into public.teacher_workload_allocations (
    workload_year_id,
    teacher_id,
    allocated_hours,
    teaching_hours_target,
    non_teaching_hours,
    notes,
    source,
    metadata
  )
  select
    v_workload_year_id,
    teacher.id,
    case
      when teacher.initials = 'LSSS' then 0
      when teacher.initials = 'JHM' then 100
      when teacher.initials = 'CNH' then 350
      else 750
    end as allocated_hours,
    null::numeric as teaching_hours_target,
    null::numeric as non_teaching_hours,
    case
      when teacher.initials = 'LSSS' then 'Pseudo-ressource til selvstudium, tæller ikke som almindelig lærerbelastning.'
      when teacher.initials = 'JHM' then 'Reduceret årsnorm pga. andre opgaver.'
      when teacher.initials = 'CNH' then 'Reduceret årsnorm.'
      else 'Midlertidig standardårsnorm, skal senere erstattes af egentlig opgaveoversigt.'
    end as notes,
    'manual_seed' as source,
    case
      when teacher.initials = 'LSSS' then v_seed_metadata || jsonb_build_object(
        'is_pseudo_resource', true,
        'resource_type', 'self_study'
      )
      else v_seed_metadata
    end as metadata
  from public.teachers teacher
  where teacher.school_id = v_school_id
  on conflict (workload_year_id, teacher_id) do update
  set
    allocated_hours = excluded.allocated_hours,
    teaching_hours_target = excluded.teaching_hours_target,
    non_teaching_hours = excluded.non_teaching_hours,
    notes = excluded.notes,
    source = excluded.source,
    metadata = public.teacher_workload_allocations.metadata || excluded.metadata
  where public.teacher_workload_allocations.source = 'manual_seed'
     or coalesce((public.teacher_workload_allocations.metadata ->> 'temporary')::boolean, false);

  update public.teachers teacher
  set metadata = teacher.metadata || jsonb_build_object(
    'is_pseudo_teacher', true,
    'is_resource', true,
    'resource_type', 'self_study',
    'resource_label', 'Selvstudium'
  )
  where teacher.school_id = v_school_id
    and teacher.initials = 'LSSS';
end $$;
