-- Admin auth role foundation for future server-side app writes.
-- Extends the existing organization_members table from 001 instead of
-- creating a duplicate role table. No anon write access is granted.

alter table if exists public.organization_members
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists email text,
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.organization_members
set id = gen_random_uuid()
where id is null;

update public.organization_members member
set email = auth_user.email
from auth.users auth_user
where member.user_id = auth_user.id
  and member.email is null
  and auth_user.email is not null;

update public.organization_members
set email = 'unknown-' || user_id::text || '@local.invalid'
where email is null
  and user_id is not null;

alter table public.organization_members
  alter column id set not null,
  alter column email set not null;

alter table public.organization_members
  drop constraint if exists organization_members_pkey;

alter table public.organization_members
  add constraint organization_members_pkey primary key (id);

alter table public.organization_members
  alter column user_id drop not null;

drop index if exists organization_members_organization_user_key;
create unique index if not exists organization_members_organization_user_key
on public.organization_members(organization_id, user_id)
where user_id is not null;

drop index if exists organization_members_organization_lower_email_key;
create unique index if not exists organization_members_organization_lower_email_key
on public.organization_members(organization_id, lower(email));

create index if not exists organization_members_email_idx
on public.organization_members(email);

create index if not exists organization_members_user_id_idx
on public.organization_members(user_id);

create index if not exists organization_members_role_idx
on public.organization_members(role);

create index if not exists organization_members_is_active_idx
on public.organization_members(is_active);

drop trigger if exists organization_members_set_updated_at on public.organization_members;
create trigger organization_members_set_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

alter table public.organization_members enable row level security;

revoke insert, update, delete on table public.organization_members from anon;

create or replace function public.user_has_org_role(target_org_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_org_id
      and member.user_id = auth.uid()
      and member.is_active = true
      and member.role = any(allowed_roles)
  );
$$;

do $$
declare
  v_org_id uuid;
  v_user_id uuid;
  v_email text := 'tkl@heguddannelser.dk';
begin
  select organization.id
    into v_org_id
  from public.organizations organization
  where organization.slug = 'heg'
  order by organization.created_at, organization.id
  limit 1;

  if v_org_id is null then
    raise notice '017_admin_auth_roles: organization slug heg not found. Initial owner seed skipped.';
    return;
  end if;

  select auth_user.id
    into v_user_id
  from auth.users auth_user
  where lower(auth_user.email) = lower(v_email)
  order by auth_user.created_at, auth_user.id
  limit 1;

  insert into public.organization_members (
    organization_id,
    user_id,
    email,
    role,
    is_active,
    metadata
  )
  values (
    v_org_id,
    v_user_id,
    v_email,
    'owner',
    true,
    jsonb_build_object(
      'seeded_by', '017_admin_auth_roles',
      'note', 'Initial owner placeholder. user_id is filled when auth.users contains this email.'
    )
  )
  on conflict (organization_id, (lower(email))) do update
  set
    user_id = coalesce(public.organization_members.user_id, excluded.user_id),
    role = 'owner',
    is_active = true,
    metadata = public.organization_members.metadata || excluded.metadata;

  if v_user_id is null then
    raise notice '017_admin_auth_roles: auth user for % not found. Seeded email-only owner placeholder.', v_email;
  end if;
end $$;

comment on table public.organization_members is
  'Organization membership and app role table used by server-side admin writes.';

comment on column public.organization_members.email is
  'Lower/upper preserved member email. Route checks may use this as fallback until user_id is linked.';

comment on column public.organization_members.is_active is
  'Inactive memberships must not grant read or write access.';
