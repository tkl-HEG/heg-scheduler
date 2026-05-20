-- Fill selected missing subject offering hours using explicit manual rules.
-- This migration is idempotent and only updates rows where hours are missing,
-- zero or marked as missing. Existing non-zero manual hour values are kept.
-- It does not create lesson_bookings, generator data or frontend write access.

-- 1. Arbejdsmarkedsparathed = 30 timer.
with arbejdsmarkedsparathed_targets as (
  select
    offering.id,
    offering.class_group_id,
    offering.course_subject_id
  from public.subject_offerings offering
  join public.course_subjects subject
    on subject.id = offering.course_subject_id
  where (
      subject.normalized_key = 'arbejdsmarkedsparathed'
      or lower(subject.name) = lower('Arbejdsmarkedsparathed')
    )
    and (
      offering.total_hours is null
      or offering.total_hours = 0
      or offering.hours_missing
    )
),
updated_arbejdsmarkedsparathed as (
  update public.subject_offerings offering
  set
    total_hours = 30,
    hours_missing = false,
    hours_source = 'manual_rule_arbejdsmarkedsparathed_30',
    metadata = offering.metadata || jsonb_build_object(
      'manual_rule', true,
      'manual_rule_key', 'arbejdsmarkedsparathed_30',
      'manual_hours', 30,
      'reason', 'Arbejdsmarkedsparathed er manuelt besluttet til 30 timer.'
    )
  from arbejdsmarkedsparathed_targets target
  where offering.id = target.id
  returning offering.class_group_id, offering.course_subject_id, offering.total_hours
)
update public.education_requirements requirement
set
  total_hours = updated.total_hours,
  metadata = requirement.metadata || jsonb_build_object(
    'manual_rule', true,
    'manual_rule_key', 'arbejdsmarkedsparathed_30',
    'synced_from', 'subject_offerings'
  )
from updated_arbejdsmarkedsparathed updated
where requirement.class_group_id = updated.class_group_id
  and requirement.course_subject_id = updated.course_subject_id
  and (
    requirement.total_hours is null
    or requirement.total_hours = 0
  );

-- Ensure matching education requirements are still aligned on reruns.
update public.education_requirements requirement
set
  total_hours = offering.total_hours,
  metadata = requirement.metadata || jsonb_build_object(
    'manual_rule', true,
    'manual_rule_key', 'arbejdsmarkedsparathed_30',
    'synced_from', 'subject_offerings'
  )
from public.subject_offerings offering
where offering.class_group_id = requirement.class_group_id
  and offering.course_subject_id = requirement.course_subject_id
  and offering.hours_source = 'manual_rule_arbejdsmarkedsparathed_30'
  and (
    requirement.total_hours is null
    or requirement.total_hours = 0
  );

-- 2. Dansk C / Engelsk C on GF/GF2/EUD/EUX: use known reference hours, fallback 80.
with dansk_engelsk_candidates as (
  select
    offering.id,
    offering.class_group_id,
    offering.course_subject_id,
    subject.normalized_key,
    subject.name as subject_name,
    case
      when lower(coalesce(subject.normalized_key, subject.name)) like '%dansk%c%' then 'dansk_c'
      when lower(coalesce(subject.normalized_key, subject.name)) like '%engelsk%c%' then 'engelsk_c'
      else null
    end as subject_family
  from public.subject_offerings offering
  join public.course_subjects subject
    on subject.id = offering.course_subject_id
  join public.class_groups class_group
    on class_group.id = offering.class_group_id
  left join public.class_categories category
    on category.id = class_group.class_category_id
  left join public.education_programs program
    on program.id = class_group.education_program_id
  where (
      offering.total_hours is null
      or offering.total_hours = 0
      or offering.hours_missing
    )
    and (
      lower(coalesce(subject.normalized_key, subject.name)) like '%dansk%c%'
      or lower(coalesce(subject.normalized_key, subject.name)) like '%engelsk%c%'
    )
    and (
      lower(coalesce(class_group.name, '')) like '%gf%'
      or lower(coalesce(class_group.name, '')) like '%eud%'
      or lower(coalesce(class_group.name, '')) like '%eux%'
      or lower(coalesce(category.normalized_key, category.name, '')) like '%gf%'
      or lower(coalesce(program.code::text, program.name, '')) like '%gf%'
      or lower(coalesce(program.code::text, program.name, '')) like '%eud%'
      or lower(coalesce(program.code::text, program.name, '')) like '%eux%'
    )
),
dansk_engelsk_resolved as (
  select
    candidate.*,
    coalesce(offering_reference.total_hours, requirement_reference.total_hours, 80)::numeric(7, 2) as resolved_hours,
    case
      when offering_reference.total_hours is not null or requirement_reference.total_hours is not null
        then 'manual_rule_match_dansk_engelsk_reference'
      else 'manual_rule_fallback_80'
    end as resolved_source
  from dansk_engelsk_candidates candidate
  left join lateral (
    select reference_offering.total_hours
    from public.subject_offerings reference_offering
    join public.course_subjects reference_subject
      on reference_subject.id = reference_offering.course_subject_id
    where reference_offering.id <> candidate.id
      and reference_offering.total_hours > 0
      and not reference_offering.hours_missing
      and (
        (
          candidate.subject_family = 'dansk_c'
          and lower(coalesce(reference_subject.normalized_key, reference_subject.name)) like '%dansk%c%'
        )
        or (
          candidate.subject_family = 'engelsk_c'
          and lower(coalesce(reference_subject.normalized_key, reference_subject.name)) like '%engelsk%c%'
        )
      )
    order by
      case when reference_subject.normalized_key = candidate.normalized_key then 0 else 1 end,
      reference_offering.total_hours desc
    limit 1
  ) offering_reference on true
  left join lateral (
    select requirement.total_hours
    from public.education_requirements requirement
    join public.course_subjects reference_subject
      on reference_subject.id = requirement.course_subject_id
    where requirement.total_hours > 0
      and (
        (
          candidate.subject_family = 'dansk_c'
          and lower(coalesce(reference_subject.normalized_key, reference_subject.name)) like '%dansk%c%'
        )
        or (
          candidate.subject_family = 'engelsk_c'
          and lower(coalesce(reference_subject.normalized_key, reference_subject.name)) like '%engelsk%c%'
        )
      )
    order by requirement.total_hours desc
    limit 1
  ) requirement_reference on offering_reference.total_hours is null
  where candidate.subject_family is not null
),
updated_dansk_engelsk as (
  update public.subject_offerings offering
  set
    total_hours = resolved.resolved_hours,
    hours_missing = false,
    hours_source = resolved.resolved_source,
    metadata = offering.metadata || jsonb_build_object(
      'manual_rule', true,
      'manual_rule_key', 'dansk_engelsk_reference_or_fallback',
      'subject_family', resolved.subject_family,
      'manual_hours', resolved.resolved_hours,
      'reason', 'Dansk C og Engelsk C på GF/GF2/EUD/EUX følger kendt reference, ellers fallback 80 timer.'
    )
  from dansk_engelsk_resolved resolved
  where offering.id = resolved.id
  returning offering.class_group_id, offering.course_subject_id, offering.total_hours
)
update public.education_requirements requirement
set
  total_hours = updated.total_hours,
  metadata = requirement.metadata || jsonb_build_object(
    'manual_rule', true,
    'manual_rule_key', 'dansk_engelsk_reference_or_fallback',
    'synced_from', 'subject_offerings'
  )
from updated_dansk_engelsk updated
where requirement.class_group_id = updated.class_group_id
  and requirement.course_subject_id = updated.course_subject_id
  and (
    requirement.total_hours is null
    or requirement.total_hours = 0
  );

-- Ensure matching education requirements are still aligned on reruns.
update public.education_requirements requirement
set
  total_hours = offering.total_hours,
  metadata = requirement.metadata || jsonb_build_object(
    'manual_rule', true,
    'manual_rule_key', 'dansk_engelsk_reference_or_fallback',
    'synced_from', 'subject_offerings'
  )
from public.subject_offerings offering
where offering.class_group_id = requirement.class_group_id
  and offering.course_subject_id = requirement.course_subject_id
  and offering.hours_source in (
    'manual_rule_match_dansk_engelsk_reference',
    'manual_rule_fallback_80'
  )
  and (
    requirement.total_hours is null
    or requirement.total_hours = 0
  );

-- 3. Hovedforløb container/programfag: 37 timer pr. aktiv uge.
do $$
declare
  v_without_active_weeks integer;
begin
  select count(*)
    into v_without_active_weeks
  from public.subject_offerings offering
  join public.course_subjects subject
    on subject.id = offering.course_subject_id
  join public.class_groups class_group
    on class_group.id = offering.class_group_id
  where (
      offering.total_hours is null
      or offering.total_hours = 0
      or offering.hours_missing
    )
    and (
      lower(coalesce(subject.normalized_key, subject.name, offering.name)) in (
        'bl_detail',
        'blandet_detail',
        'ikea_detail',
        'detail_ikea',
        'ikea_logistik',
        'handel',
        'kontor',
        'kontor_okonomi',
        'kontor_økonomi',
        'offentlig_administration',
        'off_administration',
        'administration',
        'logistik'
      )
      or lower(coalesce(subject.name, offering.name)) in (
        'bl. detail',
        'blandet detail',
        'ikea detail',
        'ikea logistik',
        'handel',
        'kontor',
        'kontor, økonomi',
        'kontor, okonomi',
        'offentlig administration',
        'administration',
        'logistik'
      )
    )
    and not exists (
      select 1
      from public.class_active_weeks active_week
      where active_week.class_group_id = offering.class_group_id
    );

  if v_without_active_weeks > 0 then
    raise notice 'Found % hovedforloeb container/program offerings without active weeks. They were not updated by rule 37 hours/week.', v_without_active_weeks;
  end if;
end $$;

with active_week_counts as (
  select
    class_group_id,
    count(*)::numeric as active_week_count
  from public.class_active_weeks
  group by class_group_id
),
hovedforloeb_targets as (
  select
    offering.id,
    offering.class_group_id,
    offering.course_subject_id,
    active_week_counts.active_week_count,
    (active_week_counts.active_week_count * 37)::numeric(7, 2) as resolved_hours
  from public.subject_offerings offering
  join public.course_subjects subject
    on subject.id = offering.course_subject_id
  join active_week_counts
    on active_week_counts.class_group_id = offering.class_group_id
  where (
      offering.total_hours is null
      or offering.total_hours = 0
      or offering.hours_missing
    )
    and (
      lower(coalesce(subject.normalized_key, subject.name, offering.name)) in (
        'bl_detail',
        'blandet_detail',
        'ikea_detail',
        'detail_ikea',
        'ikea_logistik',
        'handel',
        'kontor',
        'kontor_okonomi',
        'kontor_økonomi',
        'offentlig_administration',
        'off_administration',
        'administration',
        'logistik'
      )
      or lower(coalesce(subject.name, offering.name)) in (
        'bl. detail',
        'blandet detail',
        'ikea detail',
        'ikea logistik',
        'handel',
        'kontor',
        'kontor, økonomi',
        'kontor, okonomi',
        'offentlig administration',
        'administration',
        'logistik'
      )
    )
),
updated_hovedforloeb as (
  update public.subject_offerings offering
  set
    total_hours = target.resolved_hours,
    hours_missing = false,
    hours_source = 'manual_rule_hovedforloeb_37_per_week',
    metadata = offering.metadata || jsonb_build_object(
      'manual_rule', true,
      'manual_rule_key', 'hovedforloeb_37_per_week',
      'hours_per_week', 37,
      'active_weeks_count', target.active_week_count,
      'reason', 'Hovedforløb tæller 37 timer pr. uge holdet er inde.'
    )
  from hovedforloeb_targets target
  where offering.id = target.id
  returning offering.class_group_id, offering.course_subject_id, offering.total_hours
)
update public.education_requirements requirement
set
  total_hours = updated.total_hours,
  metadata = requirement.metadata || jsonb_build_object(
    'manual_rule', true,
    'manual_rule_key', 'hovedforloeb_37_per_week',
    'synced_from', 'subject_offerings'
  )
from updated_hovedforloeb updated
where requirement.class_group_id = updated.class_group_id
  and requirement.course_subject_id = updated.course_subject_id
  and (
    requirement.total_hours is null
    or requirement.total_hours = 0
  );

-- Ensure matching education requirements are still aligned on reruns.
update public.education_requirements requirement
set
  total_hours = offering.total_hours,
  metadata = requirement.metadata || jsonb_build_object(
    'manual_rule', true,
    'manual_rule_key', 'hovedforloeb_37_per_week',
    'synced_from', 'subject_offerings'
  )
from public.subject_offerings offering
where offering.class_group_id = requirement.class_group_id
  and offering.course_subject_id = requirement.course_subject_id
  and offering.hours_source = 'manual_rule_hovedforloeb_37_per_week'
  and (
    requirement.total_hours is null
    or requirement.total_hours = 0
  );
