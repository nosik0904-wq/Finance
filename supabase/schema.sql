-- Finance OS / NOSIK Cloud Sync Phase 1
-- Run this once in Supabase SQL Editor before using cloud sync.
-- This keeps the app simple: one household_state JSON record + action logs + snapshots.

create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Finance household',
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

create table if not exists public.household_state (
  household_id uuid primary key references public.households(id) on delete cascade,
  state_json jsonb not null,
  revision integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.action_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  revision integer not null,
  action_type text not null default 'state_update',
  title text not null default 'App data changed',
  detail text default '',
  source text default 'app',
  entity_type text default '',
  entity_id text default '',
  amount numeric,
  action_date date,
  before_summary jsonb,
  after_summary jsonb,
  device_label text default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.state_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  revision integer not null,
  state_json jsonb not null,
  reason text default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists household_members_user_id_idx on public.household_members(user_id);
create index if not exists household_members_household_id_idx on public.household_members(household_id);
create index if not exists action_log_household_revision_idx on public.action_log(household_id, revision desc);
create index if not exists state_snapshots_household_revision_idx on public.state_snapshots(household_id, revision desc);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_state enable row level security;
alter table public.action_log enable row level security;
alter table public.state_snapshots enable row level security;

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = auth.uid()
  );
$$;

drop policy if exists "members can read households" on public.households;
create policy "members can read households"
  on public.households for select
  using (public.is_household_member(id));

drop policy if exists "members can read household members" on public.household_members;
create policy "members can read household members"
  on public.household_members for select
  using (public.is_household_member(household_id));

drop policy if exists "members can read household state" on public.household_state;
create policy "members can read household state"
  on public.household_state for select
  using (public.is_household_member(household_id));

drop policy if exists "members can update household state" on public.household_state;
create policy "members can update household state"
  on public.household_state for update
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "members can read action log" on public.action_log;
create policy "members can read action log"
  on public.action_log for select
  using (public.is_household_member(household_id));

drop policy if exists "members can insert action log" on public.action_log;
create policy "members can insert action log"
  on public.action_log for insert
  with check (public.is_household_member(household_id));

drop policy if exists "members can read snapshots" on public.state_snapshots;
create policy "members can read snapshots"
  on public.state_snapshots for select
  using (public.is_household_member(household_id));

drop policy if exists "members can insert snapshots" on public.state_snapshots;
create policy "members can insert snapshots"
  on public.state_snapshots for insert
  with check (public.is_household_member(household_id));

create or replace function public.create_household_with_state(household_name text, initial_state jsonb)
returns table(household_id uuid, invite_code text, revision integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household_id uuid;
  new_invite_code text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  insert into public.households(name, owner_user_id)
  values (coalesce(nullif(trim(household_name), ''), 'Finance household'), auth.uid())
  returning id, households.invite_code into new_household_id, new_invite_code;

  insert into public.household_members(household_id, user_id, role)
  values (new_household_id, auth.uid(), 'owner');

  insert into public.household_state(household_id, state_json, revision, updated_by)
  values (new_household_id, coalesce(initial_state, '{}'::jsonb), 1, auth.uid());

  insert into public.state_snapshots(household_id, revision, state_json, reason, created_by)
  values (new_household_id, 1, coalesce(initial_state, '{}'::jsonb), 'Cloud household created', auth.uid());

  return query select new_household_id, new_invite_code, 1;
end;
$$;

create or replace function public.join_household_by_code(invite_code_input text)
returns table(household_id uuid, invite_code text, revision integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  found_household_id uuid;
  found_invite_code text;
  found_revision integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  select h.id, h.invite_code into found_household_id, found_invite_code
  from public.households h
  where h.invite_code = upper(regexp_replace(coalesce(invite_code_input, ''), '[^A-Za-z0-9]', '', 'g'))
  limit 1;

  if found_household_id is null then
    raise exception 'Invite code not found.';
  end if;

  insert into public.household_members(household_id, user_id, role)
  values (found_household_id, auth.uid(), 'member')
  on conflict (household_id, user_id) do nothing;

  select hs.revision into found_revision
  from public.household_state hs
  where hs.household_id = found_household_id;

  return query select found_household_id, found_invite_code, coalesce(found_revision, 1);
end;
$$;

grant execute on function public.create_household_with_state(text, jsonb) to authenticated;
grant execute on function public.join_household_by_code(text) to authenticated;
