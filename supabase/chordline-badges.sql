-- Chordline badges
-- Run this in your Supabase project: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is safe to run again; it won't delete existing badges.
--
-- Everyone using Chordline can READ badges (that's how they show up on profiles).
-- Changes only happen through the admin_* functions below, which require a secret admin key.
-- Only a hash of the key is stored here, so the key itself never appears in the database or the repo.

create extension if not exists pgcrypto with schema extensions;

-- Badges (name is shown when hovering the badge, icon is an https link or a small embedded image)
create table if not exists public.badges (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    icon_url text not null,
    created_at timestamptz not null default now()
);

alter table public.badges drop constraint if exists badges_name_check;
alter table public.badges add constraint badges_name_check
    check (char_length(name) between 1 and 64);
alter table public.badges drop constraint if exists badges_icon_url_check;
alter table public.badges add constraint badges_icon_url_check
    check ((icon_url ~ '^https://' or icon_url ~ '^data:image/(png|jpeg|gif|webp);base64,') and char_length(icon_url) <= 200000);

-- Which Discord users have which badge
create table if not exists public.badge_holders (
    badge_id uuid not null references public.badges (id) on delete cascade,
    user_id text not null check (user_id ~ '^[0-9]{15,21}$'),
    created_at timestamptz not null default now(),
    primary key (badge_id, user_id)
);

-- Per-person display settings, changed from Discord's own badge customization screen
alter table public.badge_holders add column if not exists hidden boolean not null default false;
alter table public.badge_holders add column if not exists position integer;

-- SHA-256 hashes of admin keys. Row level security with no policies = nobody can read this through the API.
create table if not exists public.badge_admin_keys (
    key_hash text primary key,
    note text,
    created_at timestamptz not null default now()
);

alter table public.badges enable row level security;
alter table public.badge_holders enable row level security;
alter table public.badge_admin_keys enable row level security;

-- Reading is open to everyone; there are no insert/update/delete policies, so direct writes are refused
drop policy if exists "Anyone can read badges" on public.badges;
create policy "Anyone can read badges" on public.badges
    for select using (true);

drop policy if exists "Anyone can read badge holders" on public.badge_holders;
create policy "Anyone can read badge holders" on public.badge_holders
    for select using (true);

-- Remove the old email sign-in setup from the first version of this file
drop policy if exists "Admins manage badges" on public.badges;
drop policy if exists "Admins manage badge holders" on public.badge_holders;
drop policy if exists "Admins upload badge images" on storage.objects;
drop policy if exists "Admins update badge images" on storage.objects;
drop policy if exists "Admins delete badge images" on storage.objects;
drop table if exists public.badge_admins;
drop function if exists public.is_badge_admin();

-- Admin functions

create or replace function public.check_badge_admin_key(admin_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if admin_key is null or not exists (
        select 1 from public.badge_admin_keys
        where key_hash = encode(extensions.digest(admin_key, 'sha256'), 'hex')
    ) then
        raise exception 'Invalid admin key' using errcode = '42501';
    end if;
end;
$$;
revoke all on function public.check_badge_admin_key(text) from public, anon, authenticated;

create or replace function public.admin_check(admin_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.check_badge_admin_key(admin_key);
    return true;
end;
$$;

create or replace function public.admin_create_badge(admin_key text, badge_name text, badge_icon text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    new_id uuid;
begin
    perform public.check_badge_admin_key(admin_key);
    insert into public.badges (name, icon_url) values (badge_name, badge_icon) returning id into new_id;
    return new_id;
end;
$$;

create or replace function public.admin_update_badge(admin_key text, badge_id uuid, badge_name text, badge_icon text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.check_badge_admin_key(admin_key);
    update public.badges set name = badge_name, icon_url = badge_icon where id = badge_id;
end;
$$;

create or replace function public.admin_delete_badge(admin_key text, badge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.check_badge_admin_key(admin_key);
    delete from public.badges where id = badge_id;
end;
$$;

create or replace function public.admin_give_badge(admin_key text, badge_id uuid, discord_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.check_badge_admin_key(admin_key);
    insert into public.badge_holders (badge_id, user_id) values (badge_id, discord_user_id)
    on conflict do nothing;
end;
$$;

create or replace function public.admin_take_badge(admin_key text, badge_id uuid, discord_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.check_badge_admin_key(admin_key);
    delete from public.badge_holders h where h.badge_id = admin_take_badge.badge_id and h.user_id = discord_user_id;
end;
$$;

-- Lets someone hide, show and reorder the Chordline badges they already have.
-- No admin key needed: it can only change hidden/position, never give or take badges.
create or replace function public.save_badge_settings(discord_user_id text, display_order uuid[], hidden_badges uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.badge_holders h
    set hidden = h.badge_id = any(coalesce(save_badge_settings.hidden_badges, '{}')),
        position = array_position(save_badge_settings.display_order, h.badge_id)
    where h.user_id = discord_user_id;
end;
$$;

grant execute on function public.save_badge_settings(text, uuid[], uuid[]) to anon, authenticated;

grant execute on function
    public.admin_check(text),
    public.admin_create_badge(text, text, text),
    public.admin_update_badge(text, uuid, text, text),
    public.admin_delete_badge(text, uuid),
    public.admin_give_badge(text, uuid, text),
    public.admin_take_badge(text, uuid, text)
to anon, authenticated;

-- LAST STEP: register your admin key's hash (Claude gives you this line with the real hash):
-- insert into public.badge_admin_keys (key_hash, note) values ('<sha256 hash of your key>', 'owner') on conflict do nothing;
