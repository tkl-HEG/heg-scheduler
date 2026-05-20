-- Seed core planning data required before Excel/prototype imports.
-- 001 does not have organization/school slug columns, so the seed identifies
-- the default organization and school by name.
-- 001 also has only school_blocks.starts_at, so the full block interval is
-- kept in the label while starts_at stores the start time.

do $$
declare
  v_org_id uuid;
  v_school_id uuid;
begin
  select organization.id
    into v_org_id
  from public.organizations organization
  where organization.name = 'HEG / Skole'
  order by organization.created_at, organization.id
  limit 1;

  if v_org_id is null then
    insert into public.organizations (name)
    values ('HEG / Skole')
    returning id into v_org_id;
  end if;

  select school.id
    into v_school_id
  from public.schools school
  where school.organization_id = v_org_id
    and school.name = 'HEG'
  order by school.created_at, school.id
  limit 1;

  if v_school_id is null then
    insert into public.schools (
      organization_id,
      name,
      timezone,
      block_hours,
      max_week
    )
    values (
      v_org_id,
      'HEG',
      'Europe/Copenhagen',
      1.50,
      60
    )
    returning id into v_school_id;
  else
    update public.schools
    set
      name = 'HEG',
      timezone = 'Europe/Copenhagen',
      block_hours = 1.50,
      max_week = 60
    where id = v_school_id;
  end if;

  insert into public.school_weekdays (
    school_id,
    day_of_week,
    label,
    short_label,
    sort_order
  )
  values
    (v_school_id, 0, 'Mandag', 'Man', 1),
    (v_school_id, 1, 'Tirsdag', 'Tir', 2),
    (v_school_id, 2, 'Onsdag', 'Ons', 3),
    (v_school_id, 3, 'Torsdag', 'Tor', 4),
    (v_school_id, 4, 'Fredag', 'Fre', 5)
  on conflict (school_id, day_of_week) do update
  set
    label = excluded.label,
    short_label = excluded.short_label,
    sort_order = excluded.sort_order;

  insert into public.school_blocks (
    school_id,
    block_no,
    label,
    starts_at,
    pair_no,
    sort_order
  )
  values
    (v_school_id, 1, 'Blok 1 (08:00-09:30)', '08:00'::time, 1, 1),
    (v_school_id, 2, 'Blok 2 (09:55-11:25)', '09:55'::time, 1, 2),
    (v_school_id, 3, 'Blok 3 (11:55-13:25)', '11:55'::time, 2, 3),
    (v_school_id, 4, 'Blok 4 (13:30-15:00)', '13:30'::time, 2, 4)
  on conflict (school_id, block_no) do update
  set
    label = excluded.label,
    starts_at = excluded.starts_at,
    pair_no = excluded.pair_no,
    sort_order = excluded.sort_order;

  insert into public.time_modules (
    school_id,
    module_no,
    name,
    module_type,
    sort_order,
    metadata
  )
  values
    (
      v_school_id,
      1,
      'Formiddag',
      'morning',
      1,
      '{"seed_key": "morning"}'::jsonb
    ),
    (
      v_school_id,
      2,
      'Eftermiddag',
      'afternoon',
      2,
      '{"seed_key": "afternoon"}'::jsonb
    )
  on conflict (school_id, module_no) do update
  set
    name = excluded.name,
    module_type = excluded.module_type,
    sort_order = excluded.sort_order,
    metadata = public.time_modules.metadata || excluded.metadata;

  insert into public.time_module_blocks (
    time_module_id,
    school_id,
    block_no,
    sort_order
  )
  select
    time_module.id,
    v_school_id,
    module_block.block_no,
    module_block.sort_order
  from (
    values
      (1, 1, 1),
      (1, 2, 2),
      (2, 3, 1),
      (2, 4, 2)
  ) as module_block(module_no, block_no, sort_order)
  join public.time_modules time_module
    on time_module.school_id = v_school_id
   and time_module.module_no = module_block.module_no
  on conflict (time_module_id, block_no) do update
  set
    school_id = excluded.school_id,
    sort_order = excluded.sort_order;

  insert into public.room_types (
    school_id,
    code,
    name,
    description
  )
  values
    (v_school_id, 'standard_classroom', 'almindeligt lokale', 'Standard undervisningslokale'),
    (v_school_id, 'it_room', 'IT-lokale', 'Lokale med IT-udstyr eller særlig IT-kapacitet'),
    (v_school_id, 'workshop', 'værksted', 'Praktisk lokale eller værksted'),
    (v_school_id, 'meeting_room', 'mødelokale', 'Møderum eller mindre undervisningsrum'),
    (v_school_id, 'online', 'online', 'Virtuelt lokale eller fjernundervisning')
  on conflict (school_id, code) do update
  set
    name = excluded.name,
    description = excluded.description;

  -- Main categories. planning_profile can later guide generator behavior.
  with roots(normalized_key, name, sort_order, planning_profile, notes) as (
    values
      (
        'grundfag',
        'Grundfag',
        1,
        '{"prefer_two_subjects_per_day": true, "default_generation_profile": "two_subjects_per_day"}'::jsonb,
        'Grundforløb og studieårgange hvor generatoren helst skal planlægge to forskellige fag pr. dag.'
      ),
      (
        'hovedforloeb',
        'Hovedforløb',
        2,
        '{"flexible_daily_subject_mix": true, "default_generation_profile": "flexible"}'::jsonb,
        'Hovedforløb er mere fleksible end grundforløb.'
      ),
      (
        'brobygning',
        'Brobygning',
        3,
        '{"short_course": true, "default_generation_profile": "compact"}'::jsonb,
        'Brobygning planlægges typisk som korte komprimerede forløb.'
      ),
      (
        'amu',
        'AMU',
        4,
        '{"flexible_daily_subject_mix": true, "default_generation_profile": "flexible"}'::jsonb,
        'AMU-forløb kan senere udvides med mere detaljerede krav.'
      )
  ),
  updated as (
    update public.class_categories category
    set
      category_level = 'main'::public.class_category_level,
      name = roots.name,
      normalized_key = roots.normalized_key,
      sort_order = roots.sort_order,
      planning_profile = roots.planning_profile,
      notes = roots.notes
    from roots
    where category.school_id = v_school_id
      and category.parent_id is null
      and (
        coalesce(category.normalized_key, lower(category.name)) = roots.normalized_key
        or lower(category.name) = lower(roots.name)
      )
    returning category.id
  )
  insert into public.class_categories (
    school_id,
    parent_id,
    category_level,
    name,
    normalized_key,
    sort_order,
    planning_profile,
    notes
  )
  select
    v_school_id,
    null,
    'main'::public.class_category_level,
    roots.name,
    roots.normalized_key,
    roots.sort_order,
    roots.planning_profile,
    roots.notes
  from roots
  where not exists (
    select 1
    from public.class_categories category
    where category.school_id = v_school_id
      and category.parent_id is null
      and (
        coalesce(category.normalized_key, lower(category.name)) = roots.normalized_key
        or lower(category.name) = lower(roots.name)
      )
  );

  with subcategories(parent_key, normalized_key, name, sort_order, planning_profile) as (
    values
      ('grundfag', 'gf1', 'GF1', 1, '{"prefer_two_subjects_per_day": true}'::jsonb),
      ('grundfag', 'gf2', 'GF2', 2, '{"prefer_two_subjects_per_day": true}'::jsonb),
      ('grundfag', 'staa1', 'STÅ1', 3, '{"prefer_two_subjects_per_day": true}'::jsonb),
      ('grundfag', 'staa2', 'STÅ2', 4, '{"prefer_two_subjects_per_day": true}'::jsonb),
      ('hovedforloeb', 'detail', 'detail', 1, '{"flexible_daily_subject_mix": true}'::jsonb),
      ('hovedforloeb', 'detail_ikea', 'detail Ikea', 2, '{"flexible_daily_subject_mix": true}'::jsonb),
      ('hovedforloeb', 'logistik', 'logistik', 3, '{"flexible_daily_subject_mix": true}'::jsonb),
      ('hovedforloeb', 'administration', 'administration', 4, '{"flexible_daily_subject_mix": true}'::jsonb),
      ('hovedforloeb', 'handel', 'handel', 5, '{"flexible_daily_subject_mix": true}'::jsonb),
      ('brobygning', '8_klasse', '8. klasse', 1, '{"short_course": true}'::jsonb),
      ('brobygning', '9_klasse', '9. klasse', 2, '{"short_course": true}'::jsonb),
      ('brobygning', '10_klasse', '10. klasse', 3, '{"short_course": true}'::jsonb),
      ('brobygning', 'oevrig', 'øvrig', 4, '{"short_course": true}'::jsonb)
  ),
  parents as (
    select
      category.id,
      coalesce(category.normalized_key, lower(category.name)) as normalized_key
    from public.class_categories category
    where category.school_id = v_school_id
      and category.parent_id is null
  ),
  updated as (
    update public.class_categories category
    set
      category_level = 'subcategory'::public.class_category_level,
      name = subcategories.name,
      normalized_key = subcategories.normalized_key,
      sort_order = subcategories.sort_order,
      planning_profile = subcategories.planning_profile
    from subcategories
    join parents
      on parents.normalized_key = subcategories.parent_key
    where category.school_id = v_school_id
      and category.parent_id = parents.id
      and (
        coalesce(category.normalized_key, lower(category.name)) = subcategories.normalized_key
        or lower(category.name) = lower(subcategories.name)
      )
    returning category.id
  )
  insert into public.class_categories (
    school_id,
    parent_id,
    category_level,
    name,
    normalized_key,
    sort_order,
    planning_profile
  )
  select
    v_school_id,
    parents.id,
    'subcategory'::public.class_category_level,
    subcategories.name,
    subcategories.normalized_key,
    subcategories.sort_order,
    subcategories.planning_profile
  from subcategories
  join parents
    on parents.normalized_key = subcategories.parent_key
  where not exists (
    select 1
    from public.class_categories category
    where category.school_id = v_school_id
      and category.parent_id = parents.id
      and (
        coalesce(category.normalized_key, lower(category.name)) = subcategories.normalized_key
        or lower(category.name) = lower(subcategories.name)
      )
  );

  with programs(code, name, category_key, planning_defaults, notes) as (
    values
      ('gf1', 'GF1', 'gf1', '{"prefer_two_subjects_per_day": true, "scope_hint": "class"}'::jsonb, 'Startprogram for GF1.'),
      ('gf2', 'GF2', 'gf2', '{"prefer_two_subjects_per_day": true, "scope_hint": "class"}'::jsonb, 'Startprogram for GF2.'),
      ('staa1', 'STÅ1', 'staa1', '{"prefer_two_subjects_per_day": true, "scope_hint": "class"}'::jsonb, 'Startprogram for STÅ1.'),
      ('staa2', 'STÅ2', 'staa2', '{"prefer_two_subjects_per_day": true, "scope_hint": "class"}'::jsonb, 'Startprogram for STÅ2.'),
      ('amu', 'AMU', 'amu', '{"flexible_daily_subject_mix": true, "scope_hint": "category"}'::jsonb, 'Startprogram for AMU.'),
      ('hovedforloeb_detail', 'Hovedforløb detail', 'detail', '{"flexible_daily_subject_mix": true, "scope_hint": "category"}'::jsonb, 'Startprogram for hovedforløb detail.'),
      ('hovedforloeb_detail_ikea', 'Hovedforløb detail Ikea', 'detail_ikea', '{"flexible_daily_subject_mix": true, "scope_hint": "category"}'::jsonb, 'Startprogram for hovedforløb detail Ikea.'),
      ('hovedforloeb_logistik', 'Hovedforløb logistik', 'logistik', '{"flexible_daily_subject_mix": true, "scope_hint": "category"}'::jsonb, 'Startprogram for hovedforløb logistik.'),
      ('hovedforloeb_administration', 'Hovedforløb administration', 'administration', '{"flexible_daily_subject_mix": true, "scope_hint": "category"}'::jsonb, 'Startprogram for hovedforløb administration.'),
      ('hovedforloeb_handel', 'Hovedforløb handel', 'handel', '{"flexible_daily_subject_mix": true, "scope_hint": "category"}'::jsonb, 'Startprogram for hovedforløb handel.'),
      ('brobygning_8_klasse', 'Brobygning 8. klasse', '8_klasse', '{"short_course": true, "scope_hint": "category"}'::jsonb, 'Startprogram for brobygning 8. klasse.'),
      ('brobygning_9_klasse', 'Brobygning 9. klasse', '9_klasse', '{"short_course": true, "scope_hint": "category"}'::jsonb, 'Startprogram for brobygning 9. klasse.'),
      ('brobygning_10_klasse', 'Brobygning 10. klasse', '10_klasse', '{"short_course": true, "scope_hint": "category"}'::jsonb, 'Startprogram for brobygning 10. klasse.'),
      ('brobygning_oevrig', 'Brobygning øvrig', 'oevrig', '{"short_course": true, "scope_hint": "category"}'::jsonb, 'Startprogram for øvrig brobygning.')
  ),
  category_lookup as (
    select
      category.id,
      coalesce(category.normalized_key, lower(category.name)) as normalized_key
    from public.class_categories category
    where category.school_id = v_school_id
  )
  insert into public.education_programs (
    school_id,
    code,
    name,
    description,
    default_class_category_id,
    planning_defaults,
    notes,
    is_active
  )
  select
    v_school_id,
    programs.code,
    programs.name,
    programs.name || ' uddannelsesprogram',
    category_lookup.id,
    programs.planning_defaults,
    programs.notes,
    true
  from programs
  left join category_lookup
    on category_lookup.normalized_key = programs.category_key
  on conflict (school_id, code) do update
  set
    name = excluded.name,
    description = excluded.description,
    default_class_category_id = excluded.default_class_category_id,
    planning_defaults = public.education_programs.planning_defaults || excluded.planning_defaults,
    notes = excluded.notes,
    is_active = true;
end $$;
