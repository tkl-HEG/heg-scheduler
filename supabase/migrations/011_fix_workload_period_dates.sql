-- Correct workload year and half-year period dates for 2026/2027.
-- Migration 010 created the workload model; this migration only adjusts the
-- seeded dates and metadata for the HEG 2026/2027 workload year.

do $$
declare
  v_workload_year_id uuid;
  v_semester_metadata jsonb := jsonb_build_object(
    'semester_model', 'school_half_year',
    'autumn_extends_into_january', true,
    'typical_autumn_start_week', 33,
    'typical_holiday_weeks', jsonb_build_array(42, 52),
    'note', 'Efterårssemesteret går normalt ca. to uger ind i januar, da semesteret består af ca. 20 undervisningsuger plus ferie.'
  );
begin
  select id
    into v_workload_year_id
  from public.workload_years
  where label = '2026/2027'
  order by created_at, id
  limit 1;

  if v_workload_year_id is null then
    raise notice 'Workload year 2026/2027 was not found. Migration 011 did not update any workload dates.';
    return;
  end if;

  update public.workload_years
  set
    starts_on = '2026-08-01'::date,
    ends_on = '2027-07-31'::date,
    metadata = metadata || v_semester_metadata
  where id = v_workload_year_id;

  update public.workload_periods
  set
    starts_on = '2026-08-01'::date,
    ends_on = '2027-01-17'::date,
    metadata = metadata || v_semester_metadata || jsonb_build_object(
      'corrected_by', 'migration_011',
      'period_role', 'autumn'
    )
  where workload_year_id = v_workload_year_id
    and label = 'Efterår 2026';

  update public.workload_periods
  set
    starts_on = '2027-01-18'::date,
    ends_on = '2027-07-31'::date,
    metadata = metadata || v_semester_metadata || jsonb_build_object(
      'corrected_by', 'migration_011',
      'period_role', 'spring'
    )
  where workload_year_id = v_workload_year_id
    and label = 'Forår 2027';
end $$;
