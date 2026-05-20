-- Schema hardening before importing real prototype/Excel data.
-- Adds stable slugs for organization/school lookup and explicit block end times.

alter table if exists public.organizations
  add column if not exists slug text;

with heg_organizations as (
  select
    organization.id,
    row_number() over (order by organization.created_at, organization.id) as slug_rank
  from public.organizations organization
  where organization.name = 'HEG / Skole'
)
update public.organizations organization
set slug = case
  when heg_organizations.slug_rank = 1 then 'heg'
  else 'heg-' || left(organization.id::text, 8)
end
from heg_organizations
where organization.id = heg_organizations.id;

with organization_slugs as (
  select
    organization.id,
    coalesce(
      nullif(
        regexp_replace(
          regexp_replace(lower(btrim(organization.name)), '[^a-z0-9]+', '-', 'g'),
          '(^-|-$)',
          '',
          'g'
        ),
        ''
      ),
      'organization'
    ) as base_slug
  from public.organizations organization
),
first_heg as (
  select organization.id
  from public.organizations organization
  where organization.name = 'HEG / Skole'
  order by organization.created_at, organization.id
  limit 1
)
update public.organizations organization
set slug = case
  when first_heg.id is not null then 'heg'
  else organization_slugs.base_slug || '-' || left(organization.id::text, 8)
end
from organization_slugs
left join first_heg
  on first_heg.id = organization_slugs.id
where organization.id = organization_slugs.id;

with normalized as (
  select
    organization.id,
    coalesce(
      nullif(
        regexp_replace(
          regexp_replace(lower(btrim(organization.slug)), '[^a-z0-9]+', '-', 'g'),
          '(^-|-$)',
          '',
          'g'
        ),
        ''
      ),
      'organization-' || left(organization.id::text, 8)
    ) as normalized_slug
  from public.organizations organization
)
update public.organizations organization
set slug = normalized.normalized_slug
from normalized
where organization.id = normalized.id;

with duplicate_slugs as (
  select
    organization.id,
    organization.slug,
    row_number() over (partition by organization.slug order by organization.created_at, organization.id) as slug_rank
  from public.organizations organization
)
update public.organizations organization
set slug = duplicate_slugs.slug || '-' || left(organization.id::text, 8)
from duplicate_slugs
where organization.id = duplicate_slugs.id
  and duplicate_slugs.slug_rank > 1;

with normalized as (
  select
    organization.id,
    nullif(
      regexp_replace(
        regexp_replace(lower(btrim(organization.slug)), '[^a-z0-9]+', '-', 'g'),
        '(^-|-$)',
        '',
        'g'
      ),
      ''
    ) as normalized_slug
  from public.organizations organization
)
update public.organizations organization
set slug = coalesce(normalized.normalized_slug, 'organization-' || left(organization.id::text, 8))
from normalized
where organization.id = normalized.id;

with duplicate_slugs as (
  select
    organization.id,
    organization.slug,
    row_number() over (partition by organization.slug order by organization.created_at, organization.id) as slug_rank
  from public.organizations organization
)
update public.organizations organization
set slug = duplicate_slugs.slug || '-' || replace(organization.id::text, '-', '')
from duplicate_slugs
where organization.id = duplicate_slugs.id
  and duplicate_slugs.slug_rank > 1;

alter table if exists public.organizations
  alter column slug set not null;

create unique index if not exists organizations_slug_key
  on public.organizations(slug);

comment on column public.organizations.slug is
  'Stable organization key used by seed/import scripts. HEG standard organization uses slug heg.';

alter table if exists public.schools
  add column if not exists slug text;

with heg_schools as (
  select
    school.id,
    row_number() over (
      partition by school.organization_id
      order by school.created_at, school.id
    ) as slug_rank
  from public.schools school
  where school.name = 'HEG'
)
update public.schools school
set slug = case
  when heg_schools.slug_rank = 1 then 'heg'
  else 'heg-' || left(school.id::text, 8)
end
from heg_schools
where school.id = heg_schools.id;

with school_slugs as (
  select
    school.id,
    coalesce(
      nullif(
        regexp_replace(
          regexp_replace(lower(btrim(school.name)), '[^a-z0-9]+', '-', 'g'),
          '(^-|-$)',
          '',
          'g'
        ),
        ''
      ),
      'school'
    ) as base_slug
  from public.schools school
),
first_heg_schools as (
  select distinct on (school.organization_id)
    school.id
  from public.schools school
  where school.name = 'HEG'
  order by school.organization_id, school.created_at, school.id
)
update public.schools school
set slug = case
  when first_heg_schools.id is not null then 'heg'
  else school_slugs.base_slug || '-' || left(school.id::text, 8)
end
from school_slugs
left join first_heg_schools
  on first_heg_schools.id = school_slugs.id
where school.id = school_slugs.id;

with normalized as (
  select
    school.id,
    coalesce(
      nullif(
        regexp_replace(
          regexp_replace(lower(btrim(school.slug)), '[^a-z0-9]+', '-', 'g'),
          '(^-|-$)',
          '',
          'g'
        ),
        ''
      ),
      'school-' || left(school.id::text, 8)
    ) as normalized_slug
  from public.schools school
)
update public.schools school
set slug = normalized.normalized_slug
from normalized
where school.id = normalized.id;

with duplicate_slugs as (
  select
    school.id,
    school.slug,
    row_number() over (
      partition by school.organization_id, school.slug
      order by school.created_at, school.id
    ) as slug_rank
  from public.schools school
)
update public.schools school
set slug = duplicate_slugs.slug || '-' || left(school.id::text, 8)
from duplicate_slugs
where school.id = duplicate_slugs.id
  and duplicate_slugs.slug_rank > 1;

with normalized as (
  select
    school.id,
    nullif(
      regexp_replace(
        regexp_replace(lower(btrim(school.slug)), '[^a-z0-9]+', '-', 'g'),
        '(^-|-$)',
        '',
        'g'
      ),
      ''
    ) as normalized_slug
  from public.schools school
)
update public.schools school
set slug = coalesce(normalized.normalized_slug, 'school-' || left(school.id::text, 8))
from normalized
where school.id = normalized.id;

with duplicate_slugs as (
  select
    school.id,
    school.slug,
    row_number() over (
      partition by school.organization_id, school.slug
      order by school.created_at, school.id
    ) as slug_rank
  from public.schools school
)
update public.schools school
set slug = duplicate_slugs.slug || '-' || replace(school.id::text, '-', '')
from duplicate_slugs
where school.id = duplicate_slugs.id
  and duplicate_slugs.slug_rank > 1;

alter table if exists public.schools
  alter column slug set not null;

create unique index if not exists schools_organization_slug_key
  on public.schools(organization_id, slug);

comment on column public.schools.slug is
  'Stable school key scoped to organization. HEG standard school uses slug heg.';

alter table if exists public.school_blocks
  add column if not exists ends_at time;

update public.school_blocks block
set ends_at = case block.block_no
  when 1 then '09:30'::time
  when 2 then '11:25'::time
  when 3 then '13:25'::time
  when 4 then '15:00'::time
  else block.ends_at
end
where block.block_no in (1, 2, 3, 4);

comment on column public.school_blocks.ends_at is
  'End time for the timetable block. Standard HEG block 2 ends at 11:25.';
