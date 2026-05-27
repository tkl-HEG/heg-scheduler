-- Soft lifecycle for class groups (hold).
-- Holds are master data and may be referenced by offerings, requirements,
-- calendar rows and imports, so admin removal must be archival rather than
-- hard delete.

alter table public.class_groups
  add column if not exists is_active boolean not null default true,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text,
  add column if not exists archived_reason text;

create index if not exists class_groups_is_active_idx
  on public.class_groups(is_active);

create index if not exists class_groups_school_id_is_active_idx
  on public.class_groups(school_id, is_active);

comment on column public.class_groups.is_active is
  'Soft lifecycle flag for admin-managed holds. False means inactive/archived, never hard-deleted.';

comment on column public.class_groups.archived_at is
  'Timestamp when an admin deactivated the hold.';

comment on column public.class_groups.archived_by is
  'Auth user id/email recorded by the server-side admin route when deactivated.';

comment on column public.class_groups.archived_reason is
  'Short reason supplied by the admin UI or server route.';
