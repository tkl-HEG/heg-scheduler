-- Add the shared STAA programme used by the staggered STAA1/STAA2 cohorts.
-- STAA1 and STAA2 are kept as cohort programmes/categories for calendar and
-- exam/project differences, while ordinary teaching can share the common STAA
-- programme and combined teaching group.

do $$
declare
  v_school_id uuid;
  v_grundfag_id uuid;
  v_staa_category_id uuid;
  v_staa_program_id uuid;
  v_staa_metadata jsonb := '{
    "cohort_model": "staggered",
    "cohorts": [
      {
        "code": "staa1",
        "label": "STÅ1",
        "starts": "august",
        "ends": "juni"
      },
      {
        "code": "staa2",
        "label": "STÅ2",
        "starts": "januar",
        "ends": "december"
      }
    ],
    "combined_teaching": true,
    "combined_teaching_group_key": "staa_combined"
  }'::jsonb;
begin
  select school.id
    into v_school_id
  from public.schools school
  where school.slug = 'heg'
  order by school.created_at, school.id
  limit 1;

  if v_school_id is null then
    select school.id
      into v_school_id
    from public.schools school
    where school.name = 'HEG'
    order by school.created_at, school.id
    limit 1;
  end if;

  if v_school_id is null then
    raise exception 'Cannot create shared STAA programme: HEG school was not found. Run migrations 003 and 004 first.';
  end if;

  select category.id
    into v_grundfag_id
  from public.class_categories category
  where category.school_id = v_school_id
    and category.parent_id is null
    and coalesce(category.normalized_key, lower(category.name)) = 'grundfag'
  limit 1;

  if v_grundfag_id is null then
    raise exception 'Cannot create shared STAA category: parent category grundfag was not found. Run migration 003 first.';
  end if;

  update public.class_categories category
  set
    category_level = 'subcategory'::public.class_category_level,
    name = 'STÅ',
    normalized_key = 'staa',
    sort_order = 3,
    planning_profile = category.planning_profile || jsonb_build_object(
      'prefer_two_subjects_per_day', true,
      'cohort_model', 'staggered',
      'combined_teaching', true,
      'combined_teaching_group_key', 'staa_combined'
    ),
    notes = 'Fælles STÅ-kategori for STÅ1 og STÅ2. Kohorterne er forskudte, men sammenlæser almindelige fag.',
    metadata = category.metadata || v_staa_metadata
  where category.school_id = v_school_id
    and category.parent_id = v_grundfag_id
    and coalesce(category.normalized_key, lower(category.name)) = 'staa'
  returning category.id into v_staa_category_id;

  if v_staa_category_id is null then
    insert into public.class_categories (
      school_id,
      parent_id,
      category_level,
      name,
      normalized_key,
      sort_order,
      planning_profile,
      notes,
      metadata
    )
    values (
      v_school_id,
      v_grundfag_id,
      'subcategory'::public.class_category_level,
      'STÅ',
      'staa',
      3,
      jsonb_build_object(
        'prefer_two_subjects_per_day', true,
        'cohort_model', 'staggered',
        'combined_teaching', true,
        'combined_teaching_group_key', 'staa_combined'
      ),
      'Fælles STÅ-kategori for STÅ1 og STÅ2. Kohorterne er forskudte, men sammenlæser almindelige fag.',
      v_staa_metadata
    )
    returning id into v_staa_category_id;
  end if;

  insert into public.education_programs (
    school_id,
    code,
    name,
    description,
    default_class_category_id,
    default_period_value,
    default_period_unit,
    planning_defaults,
    notes,
    is_active,
    metadata
  )
  values (
    v_school_id,
    'staa',
    'Studenteråret / STÅ',
    'Fælles studenterårsforløb for STÅ1 og STÅ2. STÅ1 og STÅ2 er forskudte kohorter, men sammenlæser almindelige fag.',
    v_staa_category_id,
    40,
    'weeks'::public.period_unit,
    jsonb_build_object(
      'prefer_two_subjects_per_day', true,
      'scope_hint', 'common_program',
      'cohort_model', 'staggered',
      'combined_teaching', true,
      'combined_teaching_group_key', 'staa_combined'
    ),
    'Fælles program for STÅ. Brug metadata/cohort_type til STÅ1/STÅ2-perioder, eksamener, projekter og vigtige datoer.',
    true,
    v_staa_metadata
  )
  on conflict (school_id, code) do update
  set
    name = excluded.name,
    description = excluded.description,
    default_class_category_id = excluded.default_class_category_id,
    default_period_value = excluded.default_period_value,
    default_period_unit = excluded.default_period_unit,
    planning_defaults = public.education_programs.planning_defaults || excluded.planning_defaults,
    notes = excluded.notes,
    is_active = true,
    metadata = public.education_programs.metadata || excluded.metadata
  returning id into v_staa_program_id;

  update public.class_categories category
  set
    metadata = category.metadata || jsonb_build_object(
      'cohort_of', 'staa',
      'combined_teaching_group_key', 'staa_combined'
    ),
    planning_profile = category.planning_profile || jsonb_build_object(
      'cohort_of', 'staa',
      'combined_teaching', true,
      'combined_teaching_group_key', 'staa_combined'
    )
  where category.school_id = v_school_id
    and coalesce(category.normalized_key, lower(category.name)) in ('staa1', 'staa2');

  update public.education_programs program
  set
    metadata = program.metadata || jsonb_build_object(
      'cohort_of', 'staa',
      'common_education_program_code', 'staa',
      'combined_teaching_group_key', 'staa_combined'
    ),
    planning_defaults = program.planning_defaults || jsonb_build_object(
      'cohort_of', 'staa',
      'combined_teaching', true,
      'combined_teaching_group_key', 'staa_combined'
    )
  where program.school_id = v_school_id
    and program.code in ('staa1', 'staa2');

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'education_programs'
      and column_name = 'type'
  ) then
    execute 'update public.education_programs set type = $1 where id = $2'
    using 'studenterår', v_staa_program_id;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'education_programs'
      and column_name = 'default_duration_weeks'
  ) then
    execute 'update public.education_programs set default_duration_weeks = $1 where id = $2'
    using 40, v_staa_program_id;
  end if;
end $$;
