-- Audit-log foundation for future server-side edits from the app.
-- This migration only creates the log table. It grants no anon write access
-- and does not modify lesson_bookings or generator-related data.

create table if not exists public.data_change_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid,
  change_type text not null check (
    change_type in (
      'insert',
      'update',
      'delete',
      'upsert',
      'competency_add',
      'competency_remove'
    )
  ),
  before_data jsonb,
  after_data jsonb,
  changed_by text,
  source text not null default 'app',
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists data_change_log_table_name_idx
on public.data_change_log(table_name);

create index if not exists data_change_log_record_id_idx
on public.data_change_log(record_id);

create index if not exists data_change_log_created_at_idx
on public.data_change_log(created_at desc);

create index if not exists data_change_log_changed_by_idx
on public.data_change_log(changed_by);

alter table public.data_change_log enable row level security;

revoke all on table public.data_change_log from anon;
revoke all on table public.data_change_log from authenticated;

comment on table public.data_change_log is
  'Append-only audit log for future server-side app changes. No anon write access is granted.';

comment on column public.data_change_log.table_name is
  'The public table changed, for example teacher_competencies.';

comment on column public.data_change_log.record_id is
  'The primary id of the affected record when the table uses uuid ids.';

comment on column public.data_change_log.change_type is
  'insert, update, delete, upsert, competency_add or competency_remove.';

comment on column public.data_change_log.before_data is
  'JSON snapshot before the change. Null for inserts.';

comment on column public.data_change_log.after_data is
  'JSON snapshot after the change. Null for deletes.';

comment on column public.data_change_log.changed_by is
  'Authenticated user id/email recorded by the server-side edit path when available.';

comment on column public.data_change_log.source is
  'Source of the change, for example app, import or manual_sql.';

comment on column public.data_change_log.metadata is
  'Additional structured context about the change.';