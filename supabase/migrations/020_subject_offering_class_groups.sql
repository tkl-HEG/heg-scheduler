-- Foundation for shared subject offerings across multiple class groups.
-- subject_offerings.class_group_id is intentionally kept as the legacy/primary
-- class group so existing imports, views and read-only pages remain compatible.

create table if not exists public.subject_offering_class_groups (
  subject_offering_id uuid not null references public.subject_offerings(id) on delete cascade,
  class_group_id uuid not null references public.class_groups(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  member_role text not null default 'primary',
  sort_order integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (subject_offering_id, class_group_id),
  constraint subject_offering_class_groups_member_role_check
    check (member_role in ('primary', 'secondary', 'shared', 'observer'))
);

create index if not exists subject_offering_class_groups_school_id_idx
  on public.subject_offering_class_groups(school_id);

create index if not exists subject_offering_class_groups_class_group_id_idx
  on public.subject_offering_class_groups(class_group_id);

create index if not exists subject_offering_class_groups_subject_offering_id_idx
  on public.subject_offering_class_groups(subject_offering_id);

create index if not exists subject_offering_class_groups_school_id_class_group_id_idx
  on public.subject_offering_class_groups(school_id, class_group_id);

create or replace function public.validate_subject_offering_class_group_school()
returns trigger
language plpgsql
as $$
declare
  offering_school_id uuid;
  class_school_id uuid;
begin
  select school_id
  into offering_school_id
  from public.subject_offerings
  where id = new.subject_offering_id;

  select school_id
  into class_school_id
  from public.class_groups
  where id = new.class_group_id;

  if offering_school_id is not null and new.school_id <> offering_school_id then
    raise exception 'subject_offering_class_groups.school_id must match subject_offerings.school_id';
  end if;

  if class_school_id is not null and new.school_id <> class_school_id then
    raise exception 'subject_offering_class_groups.school_id must match class_groups.school_id';
  end if;

  return new;
end;
$$;

drop trigger if exists subject_offering_class_groups_validate_school
  on public.subject_offering_class_groups;

create trigger subject_offering_class_groups_validate_school
before insert or update on public.subject_offering_class_groups
for each row execute function public.validate_subject_offering_class_group_school();

drop trigger if exists subject_offering_class_groups_set_updated_at
  on public.subject_offering_class_groups;

create trigger subject_offering_class_groups_set_updated_at
before update on public.subject_offering_class_groups
for each row execute function public.set_updated_at();

insert into public.subject_offering_class_groups (
  subject_offering_id,
  class_group_id,
  school_id,
  member_role,
  sort_order,
  metadata
)
select
  offering.id,
  offering.class_group_id,
  offering.school_id,
  'primary',
  1,
  jsonb_build_object('backfilled_from', 'subject_offerings.class_group_id')
from public.subject_offerings offering
where offering.class_group_id is not null
on conflict (subject_offering_id, class_group_id) do nothing;

alter table public.subject_offering_class_groups enable row level security;

drop policy if exists subject_offering_class_groups_read
  on public.subject_offering_class_groups;

create policy subject_offering_class_groups_read
on public.subject_offering_class_groups
for select using (public.user_can_read_school(school_id));

drop policy if exists subject_offering_class_groups_write
  on public.subject_offering_class_groups;

create policy subject_offering_class_groups_write
on public.subject_offering_class_groups
for all using (public.user_can_write_school(school_id))
with check (public.user_can_write_school(school_id));

grant usage on schema public to anon;
grant select on table public.subject_offering_class_groups to anon;

drop policy if exists readonly_dashboard_select_anon
  on public.subject_offering_class_groups;

create policy readonly_dashboard_select_anon
on public.subject_offering_class_groups
for select to anon using (true);

comment on table public.subject_offering_class_groups is
  'Join table that lets one subject_offering/teaching group include multiple class_groups for shared teaching.';

comment on column public.subject_offering_class_groups.subject_offering_id is
  'The shared subject offering/teaching group.';

comment on column public.subject_offering_class_groups.class_group_id is
  'A class group participating in the shared subject offering.';

comment on column public.subject_offering_class_groups.school_id is
  'School context. Must match both the subject_offering and class_group.';

comment on column public.subject_offering_class_groups.member_role is
  'Membership role for the class group: primary, secondary, shared or observer.';

comment on column public.subject_offering_class_groups.metadata is
  'Free-form metadata, including backfill source for legacy rows.';

comment on column public.subject_offerings.class_group_id is
  'Legacy/primary class group for compatibility. Multi-class shared teaching is represented in subject_offering_class_groups.';

comment on policy readonly_dashboard_select_anon on public.subject_offering_class_groups is
  'Read-only dashboard SELECT access for shared subject offering memberships. Does not grant write access.';
