-- Read-only workload dashboard access.
-- Grants SELECT to anon for the workload planning tables/view used by the
-- read-only app. This migration grants no insert, update or delete access.

grant usage on schema public to anon;

grant select on table public.workload_years to anon;
grant select on table public.workload_periods to anon;
grant select on table public.teacher_workload_allocations to anon;
grant select on table public.v_teacher_workload_status to anon;

do $$
declare
  workload_table text;
  workload_tables text[] := array[
    'workload_years',
    'workload_periods',
    'teacher_workload_allocations'
  ];
begin
  foreach workload_table in array workload_tables loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = workload_table
        and policyname = 'readonly_workload_select_anon'
    ) then
      execute format(
        'create policy readonly_workload_select_anon on public.%I for select to anon using (true)',
        workload_table
      );
    end if;

    execute format(
      'comment on policy readonly_workload_select_anon on public.%I is %L',
      workload_table,
      'Read-only workload SELECT access for the opgaveoversigt page. Does not grant write access.'
    );
  end loop;
end $$;
