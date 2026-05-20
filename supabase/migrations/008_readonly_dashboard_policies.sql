-- Read-only dashboard access for the first Scheduler v2 app test.
-- This migration grants SELECT access only to the anon role for the tables
-- used by the read-only dashboard. It does not grant insert, update or delete,
-- and it does not create or modify lesson_bookings.

do $$
declare
  dashboard_table text;
  dashboard_tables text[] := array[
    'teachers',
    'class_groups',
    'rooms',
    'course_subjects',
    'subject_offerings',
    'education_requirements',
    'teacher_competencies',
    'teaching_assignments',
    'official_hf_calendar_entries',
    'planning_calendar_events',
    'import_warnings',
    'data_imports',
    'class_active_weeks',
    'teacher_suggestions',
    'campuses',
    'class_categories',
    'education_programs'
  ];
begin
  grant usage on schema public to anon;

  foreach dashboard_table in array dashboard_tables loop
    if to_regclass(format('public.%I', dashboard_table)) is not null then
      execute format('grant select on table public.%I to anon', dashboard_table);

      if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = dashboard_table
          and policyname = 'readonly_dashboard_select_anon'
      ) then
        execute format(
          'create policy readonly_dashboard_select_anon on public.%I for select to anon using (true)',
          dashboard_table
        );
      end if;

      execute format(
        'comment on policy readonly_dashboard_select_anon on public.%I is %L',
        dashboard_table,
        'Read-only dashboard SELECT access for the first app test. Does not grant write access.'
      );
    end if;
  end loop;
end $$;
