-- Soft lifecycle for subject offerings / teaching groups.
-- subject_offerings are never hard-deleted by the admin UI; inactive rows stay
-- available for audit, relation checks and legacy read paths.

alter table public.subject_offerings
  add column if not exists is_active boolean not null default true,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists archived_reason text;

create index if not exists subject_offerings_school_active_idx
  on public.subject_offerings(school_id, is_active);

create index if not exists subject_offerings_active_course_subject_idx
  on public.subject_offerings(school_id, course_subject_id)
  where is_active;

create index if not exists subject_offerings_active_class_group_idx
  on public.subject_offerings(school_id, class_group_id)
  where is_active;

create index if not exists subject_offerings_archived_at_idx
  on public.subject_offerings(archived_at desc)
  where archived_at is not null;

comment on column public.subject_offerings.is_active is
  'Soft lifecycle flag for admin-managed subject offerings. False means inactive/archived; rows are not hard-deleted.';

comment on column public.subject_offerings.archived_at is
  'Timestamp for admin soft deactivation of the subject offering.';

comment on column public.subject_offerings.archived_by is
  'Authenticated user id or email that soft-deactivated the subject offering.';

comment on column public.subject_offerings.archived_reason is
  'Short reason recorded by the admin UI when a subject offering is soft-deactivated.';
