-- Chordline staff, reports and bans
-- Run this AFTER chordline-badges.sql: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is safe to run again.
--
-- Roles:  owner (you)  -> everything, including managing staff
--         dev          -> everything except managing staff (badges, reports, bans)
--         mod          -> can report users and messages
--
-- Every staff member has their own secret key; only its SHA-256 hash is stored.
-- All of these tables have row level security with no policies, so they can only be used
-- through the functions below, which check the key and work out who is calling.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.staff (
    user_id text primary key check (user_id ~ '^[0-9]{15,21}$'),
    role text not null check (role in ('owner', 'dev', 'mod')),
    key_hash text not null unique,
    added_by text,
    created_at timestamptz not null default now()
);

create table if not exists public.reports (
    id uuid primary key default gen_random_uuid(),
    reported_user_id text not null check (reported_user_id ~ '^[0-9]{15,21}$'),
    reporter_id text not null,
    reason text not null check (char_length(reason) between 1 and 1000),
    message_content text check (char_length(message_content) <= 4000),
    message_link text check (message_link ~ '^https://discord\.com/channels/'),
    status text not null default 'open' check (status in ('open', 'dismissed', 'banned')),
    handled_by text,
    handled_at timestamptz,
    created_at timestamptz not null default now()
);

-- Proof image (screenshot) attached to a report, as a small embedded image. Required for user reports.
alter table public.reports add column if not exists proof_image text;
alter table public.reports drop constraint if exists reports_proof_image_check;
alter table public.reports add constraint reports_proof_image_check
    check (proof_image is null or (proof_image ~ '^data:image/(png|jpeg|webp|gif);base64,' and char_length(proof_image) <= 2000000));

create table if not exists public.bans (
    user_id text primary key check (user_id ~ '^[0-9]{15,21}$'),
    reason text not null check (char_length(reason) between 1 and 1000),
    banned_by text not null,
    -- null = permanent
    expires_at timestamptz,
    created_at timestamptz not null default now()
);

alter table public.staff enable row level security;
alter table public.reports enable row level security;
alter table public.bans enable row level security;

-- The owner uses the admin key that was set up for badges
insert into public.staff (user_id, role, key_hash)
select '1361146748449460375', 'owner', key_hash
from public.badge_admin_keys
where note = 'owner'
on conflict (user_id) do nothing;

-- Internal: returns the caller's staff row if their key has at least the given role
create or replace function public.require_staff(staff_key text, min_role text)
returns public.staff
language plpgsql
security definer
set search_path = ''
as $$
declare
    member public.staff;
    ranks constant jsonb := '{"mod": 1, "dev": 2, "owner": 3}';
begin
    select * into member from public.staff
    where key_hash = encode(extensions.digest(coalesce(staff_key, ''), 'sha256'), 'hex');

    if member is null then
        raise exception 'Invalid staff key' using errcode = '42501';
    end if;
    if (ranks ->> member.role)::int < (ranks ->> min_role)::int then
        raise exception 'You need to be % or higher to do that', min_role using errcode = '42501';
    end if;
    return member;
end;
$$;
revoke all on function public.require_staff(text, text) from public, anon, authenticated;

-- Devs can manage badges too: badge functions now accept the owner/dev staff keys
create or replace function public.check_badge_admin_key(admin_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if exists (
        select 1 from public.badge_admin_keys
        where key_hash = encode(extensions.digest(coalesce(admin_key, ''), 'sha256'), 'hex')
    ) then
        return;
    end if;
    perform public.require_staff(admin_key, 'dev');
end;
$$;
revoke all on function public.check_badge_admin_key(text) from public, anon, authenticated;

create or replace function public.staff_new_key()
returns text
language sql
volatile
set search_path = ''
as $$
    select 'chordline_staff_' || encode(extensions.gen_random_bytes(24), 'hex');
$$;
revoke all on function public.staff_new_key() from public, anon, authenticated;

-- Who am I? Returns the caller's user id and role.
create or replace function public.staff_whoami(staff_key text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
    member public.staff := public.require_staff(staff_key, 'mod');
begin
    return json_build_object('user_id', member.user_id, 'role', member.role);
end;
$$;

-- Staff management (owner only)

create or replace function public.staff_list(staff_key text)
returns setof json
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_staff(staff_key, 'owner');
    return query
        select json_build_object('user_id', s.user_id, 'role', s.role, 'added_by', s.added_by, 'created_at', s.created_at)
        from public.staff s
        order by case s.role when 'owner' then 0 when 'dev' then 1 else 2 end, s.created_at;
end;
$$;

-- Adds or changes a staff member and returns their NEW key (shown once)
create or replace function public.staff_set(staff_key text, target_user_id text, new_role text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller public.staff := public.require_staff(staff_key, 'owner');
    new_key text := public.staff_new_key();
begin
    if new_role not in ('dev', 'mod') then
        raise exception 'Role must be dev or mod';
    end if;
    if target_user_id = caller.user_id then
        raise exception 'You can''t change your own role';
    end if;

    insert into public.staff (user_id, role, key_hash, added_by)
    values (target_user_id, new_role, encode(extensions.digest(new_key, 'sha256'), 'hex'), caller.user_id)
    on conflict (user_id) do update
        set role = excluded.role, key_hash = excluded.key_hash, added_by = excluded.added_by;
    return new_key;
end;
$$;

create or replace function public.staff_remove(staff_key text, target_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_staff(staff_key, 'owner');
    delete from public.staff where user_id = target_user_id and role <> 'owner';
end;
$$;

-- Reports

drop function if exists public.report_create(text, text, text, text, text);
create or replace function public.report_create(staff_key text, target_user_id text, report_reason text, content text default null, link text default null, proof text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller public.staff := public.require_staff(staff_key, 'mod');
begin
    -- Message reports include the message itself; user reports need a screenshot as proof
    if link is null and proof is null then
        raise exception 'Add an image as proof for the report';
    end if;

    insert into public.reports (reported_user_id, reporter_id, reason, message_content, message_link, proof_image)
    values (target_user_id, caller.user_id, report_reason, content, link, proof);
end;
$$;

create or replace function public.reports_list(staff_key text)
returns setof json
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_staff(staff_key, 'dev');
    return query
        select row_to_json(r) from public.reports r
        where r.status = 'open'
        order by r.created_at desc;
end;
$$;

create or replace function public.report_dismiss(staff_key text, target_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller public.staff := public.require_staff(staff_key, 'dev');
begin
    update public.reports set status = 'dismissed', handled_by = caller.user_id, handled_at = now()
    where id = target_report_id;
end;
$$;

-- Bans

create or replace function public.ban_add(staff_key text, target_user_id text, ban_reason text, duration_minutes integer default null, from_report_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller public.staff := public.require_staff(staff_key, 'dev');
begin
    if exists (select 1 from public.staff where user_id = target_user_id and role in ('owner', 'dev')) then
        raise exception 'You can''t ban the owner or a dev';
    end if;

    insert into public.bans (user_id, reason, banned_by, expires_at)
    values (
        target_user_id, ban_reason, caller.user_id,
        case when duration_minutes is null then null else now() + make_interval(mins => duration_minutes) end
    )
    on conflict (user_id) do update
        set reason = excluded.reason, banned_by = excluded.banned_by, expires_at = excluded.expires_at, created_at = now();

    -- Banned staff lose their role
    delete from public.staff where user_id = target_user_id and role = 'mod';

    -- Close every open report about them
    update public.reports set status = 'banned', handled_by = caller.user_id, handled_at = now()
    where status = 'open' and (reported_user_id = target_user_id or id = from_report_id);
end;
$$;

create or replace function public.ban_remove(staff_key text, target_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_staff(staff_key, 'dev');
    delete from public.bans where user_id = target_user_id;
end;
$$;

create or replace function public.bans_list(staff_key text)
returns setof json
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_staff(staff_key, 'dev');
    return query
        select row_to_json(b) from public.bans b
        where b.expires_at is null or b.expires_at > now()
        order by b.created_at desc;
end;
$$;

-- Anyone's Chordline asks this on startup to see if its user is banned
create or replace function public.get_ban(target_user_id text)
returns json
language sql
stable
security definer
set search_path = ''
as $$
    select json_build_object('reason', b.reason, 'expires_at', b.expires_at, 'created_at', b.created_at)
    from public.bans b
    where b.user_id = target_user_id and (b.expires_at is null or b.expires_at > now());
$$;

grant execute on function
    public.staff_whoami(text),
    public.staff_list(text),
    public.staff_set(text, text, text),
    public.staff_remove(text, text),
    public.report_create(text, text, text, text, text, text),
    public.reports_list(text),
    public.report_dismiss(text, uuid),
    public.ban_add(text, text, text, integer, uuid),
    public.ban_remove(text, text),
    public.bans_list(text),
    public.get_ban(text)
to anon, authenticated;

notify pgrst, 'reload schema';
