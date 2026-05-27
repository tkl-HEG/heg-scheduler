-- Soft lifecycle for course subjects.
-- This enables admin deactivation without hard-deleting subjects that may be
-- referenced by offerings, competencies, requirements or historical imports.

alter table public.course_subjects
  add column if not exists is_active boolean not null default true,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists archived_reason text;

create index if not exists course_subjects_is_active_idx
  on public.course_subjects(is_active);

create index if not exists course_subjects_school_id_is_active_idx
  on public.course_subjects(school_id, is_active);

comment on column public.course_subjects.is_active is
  'Soft lifecycle flag for admin-managed subjects. False means inactive/archived, never hard-deleted.';

comment on column public.course_subjects.archived_at is
  'Timestamp when an admin deactivated the subject.';

comment on column public.course_subjects.archived_by is
  'Auth user id/email recorded by the server-side admin route when deactivated.';

comment on column public.course_subjects.archived_reason is
  'Short reason supplied by the admin UI or server route.';
