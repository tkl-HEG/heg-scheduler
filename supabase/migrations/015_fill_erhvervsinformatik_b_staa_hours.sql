-- Fill remaining missing hours for Erhvervsinformatik B on Studenteråret/STAA.
-- Idempotent data correction: only missing/zero-hour rows are updated.
-- Does not create lesson_bookings, generator data or frontend write access.

do $$
declare
  v_missing_count integer;
begin
  select count(*)
    into v_missing_count
  from (
    values
      ('Studenteråret Aars'),
      ('Studenteråret Hobro')
  ) as expected(class_name)
  where not exists (
    select 1
    from public.subject_offerings offering
    join public.class_groups class_group
      on class_group.id = offering.class_group_id
    join public.course_subjects subject
      on subject.id = offering.course_subject_id
    where class_group.name = expected.class_name
      and subject.name = 'Erhvervsinformatik B'
  );

  if v_missing_count > 0 then
    raise notice 'Expected % Studenteråret/Erhvervsinformatik B subject offering(s) were not found.', v_missing_count;
  end if;
end $$;

with targets as (
  select
    offering.id,
    offering.class_group_id,
    offering.course_subject_id
  from public.subject_offerings offering
  join public.class_groups class_group
    on class_group.id = offering.class_group_id
  join public.course_subjects subject
    on subject.id = offering.course_subject_id
  where class_group.name in ('Studenteråret Aars', 'Studenteråret Hobro')
    and subject.name = 'Erhvervsinformatik B'
    and (
      offering.total_hours is null
      or offering.total_hours = 0
      or offering.hours_missing
    )
),
updated_offerings as (
  update public.subject_offerings offering
  set
    total_hours = 130,
    hours_missing = false,
    hours_source = 'manual_rule_erhvervsinformatik_b_staa_130',
    metadata = offering.metadata || jsonb_build_object(
      'manual_rule', true,
      'hours', 130,
      'reason', 'Erhvervsinformatik B på Studenteråret/STÅ sættes til 130 timer.'
    )
  from targets target
  where offering.id = target.id
  returning offering.class_group_id, offering.course_subject_id, offering.total_hours
)
update public.education_requirements requirement
set
  total_hours = updated.total_hours,
  metadata = requirement.metadata || jsonb_build_object(
    'manual_rule', true,
    'manual_rule_key', 'erhvervsinformatik_b_staa_130',
    'hours', 130,
    'reason', 'Erhvervsinformatik B på Studenteråret/STÅ sættes til 130 timer.',
    'synced_from', 'subject_offerings'
  )
from updated_offerings updated
where requirement.class_group_id = updated.class_group_id
  and requirement.course_subject_id = updated.course_subject_id
  and (
    requirement.total_hours is null
    or requirement.total_hours = 0
  );

-- Keep matching requirements aligned on reruns without touching non-missing rows.
update public.education_requirements requirement
set
  total_hours = offering.total_hours,
  metadata = requirement.metadata || jsonb_build_object(
    'manual_rule', true,
    'manual_rule_key', 'erhvervsinformatik_b_staa_130',
    'hours', 130,
    'reason', 'Erhvervsinformatik B på Studenteråret/STÅ sættes til 130 timer.',
    'synced_from', 'subject_offerings'
  )
from public.subject_offerings offering
where offering.class_group_id = requirement.class_group_id
  and offering.course_subject_id = requirement.course_subject_id
  and offering.hours_source = 'manual_rule_erhvervsinformatik_b_staa_130'
  and (
    requirement.total_hours is null
    or requirement.total_hours = 0
  );
