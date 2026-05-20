-- Manual stamdata correction for teachers/resources.
-- Adds LSSS as a pseudo-teacher resource for self-study and JHM as a regular
-- teacher. JHM receives competency in Arbejdsmarkedsparathed when the subject
-- already exists. This migration is idempotent and does not touch bookings.

do $$
declare
  v_school_id uuid;
  v_lsss_teacher_id uuid;
  v_jhm_teacher_id uuid;
  v_arbejdsmarkedsparathed_subject_id uuid;
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
    raise exception 'Cannot add LSSS/JHM stamdata: HEG school was not found. Run migrations 003 and 004 first.';
  end if;

  insert into public.teachers (
    school_id,
    legacy_id,
    initials,
    display_name,
    skills_summary,
    metadata
  )
  values (
    v_school_id,
    'manual-lsss',
    'LSSS',
    'Selvstudium',
    'Pseudo-ressource til selvstudium',
    jsonb_build_object(
      'source', 'manual_stamdata_correction_009',
      'is_pseudo_teacher', true,
      'is_resource', true,
      'resource_type', 'self_study',
      'resource_label', 'Selvstudium',
      'purpose', 'Bruges senere til selvstudium i fagfordeling/skema uden at booke en rigtig lærer.'
    )
  )
  on conflict (school_id, initials) do update
  set
    legacy_id = coalesce(public.teachers.legacy_id, excluded.legacy_id),
    display_name = excluded.display_name,
    skills_summary = excluded.skills_summary,
    metadata = public.teachers.metadata || excluded.metadata
  returning id into v_lsss_teacher_id;

  insert into public.teachers (
    school_id,
    legacy_id,
    initials,
    display_name,
    metadata
  )
  values (
    v_school_id,
    'manual-jhm',
    'JHM',
    'Jens Peter Hartvig Madsen',
    jsonb_build_object(
      'source', 'manual_stamdata_correction_009',
      'is_pseudo_teacher', false
    )
  )
  on conflict (school_id, initials) do update
  set
    legacy_id = coalesce(public.teachers.legacy_id, excluded.legacy_id),
    display_name = excluded.display_name,
    metadata = public.teachers.metadata || excluded.metadata
  returning id into v_jhm_teacher_id;

  select subject.id
    into v_arbejdsmarkedsparathed_subject_id
  from public.course_subjects subject
  where subject.school_id = v_school_id
    and (
      subject.normalized_key = 'arbejdsmarkedsparathed'
      or lower(subject.name) = lower('Arbejdsmarkedsparathed')
    )
  order by subject.created_at, subject.id
  limit 1;

  if v_arbejdsmarkedsparathed_subject_id is null then
    raise notice 'Course subject Arbejdsmarkedsparathed was not found for HEG. JHM was created/updated, but teacher_competency was not inserted.';
  else
    insert into public.teacher_competencies (
      school_id,
      teacher_id,
      course_subject_id,
      level,
      metadata
    )
    values (
      v_school_id,
      v_jhm_teacher_id,
      v_arbejdsmarkedsparathed_subject_id,
      'primary'::public.competency_level,
      jsonb_build_object(
        'source', 'manual_stamdata_correction_009',
        'note', 'Manual competency correction for JHM.'
      )
    )
    on conflict (teacher_id, course_subject_id, level) do update
    set
      metadata = public.teacher_competencies.metadata || excluded.metadata;
  end if;

  raise notice 'Manual stamdata correction 009 completed. LSSS id %, JHM id %.', v_lsss_teacher_id, v_jhm_teacher_id;
end $$;
