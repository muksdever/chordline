-- Chordline staff, reports and bans
-- Run this AFTER chordline-badges.sql: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is safe to run again.
--
-- Roles:  owner (you)  -> everything
--         dev          -> everything: staff, badges, reports, bans (but can't change the owner)
--         mod          -> can report users and messages
--
-- Staff are identified only by their Discord user ID, which Chordline sends with each request.
-- WARNING: the database can't verify that ID, so someone who edits their Chordline (or calls these
-- functions directly with the public anon key) can pretend to be any staff member.
--
-- The tables have row level security with no policies, so they're only used through the functions below.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.staff (
    user_id text primary key check (user_id ~ '^[0-9]{15,21}$'),
    role text not null check (role in ('owner', 'dev', 'mod')),
    added_by text,
    created_at timestamptz not null default now()
);
-- Staff used to have personal keys; they're identified by user ID now
alter table public.staff drop column if exists key_hash;

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

insert into public.staff (user_id, role)
values ('1361146748449460375', 'owner')
on conflict (user_id) do update set role = 'owner';

-- Remove the old key-based functions
drop function if exists public.staff_whoami(text);
drop function if exists public.staff_list(text);
drop function if exists public.staff_set(text, text, text);
drop function if exists public.staff_remove(text, text);
drop function if exists public.report_create(text, text, text, text, text);
drop function if exists public.report_create(text, text, text, text, text, text);
drop function if exists public.reports_list(text);
drop function if exists public.report_dismiss(text, uuid);
drop function if exists public.ban_add(text, text, text, integer, uuid);
drop function if exists public.ban_remove(text, text);
drop function if exists public.bans_list(text);
drop function if exists public.staff_new_key();
drop function if exists public.require_staff(text, text);

-- Internal: returns the caller's staff row if they have at least the given role
create or replace function public.require_staff(caller_id text, min_role text)
returns public.staff
language plpgsql
security definer
set search_path = ''
as $$
declare
    member public.staff;
    ranks constant jsonb := '{"mod": 1, "dev": 2, "owner": 3}';
begin
    select * into member from public.staff where user_id = caller_id;

    if member is null then
        raise exception 'You''re not on Chordline staff' using errcode = '42501';
    end if;
    if (ranks ->> member.role)::int < (ranks ->> min_role)::int then
        raise exception 'You need to be % or higher to do that', min_role using errcode = '42501';
    end if;
    return member;
end;
$$;
revoke all on function public.require_staff(text, text) from public, anon, authenticated;

-- Badge functions take an "admin_key"; it's now the caller's Discord user ID (owner or dev).
-- The original badge admin key still works too.
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

-- What role does this user have? null if they're not staff.
create or replace function public.staff_role(caller_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select role from public.staff where user_id = caller_id;
$$;

-- Staff management (devs and owner)

create or replace function public.staff_list(caller_id text)
returns setof json
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_staff(caller_id, 'dev');
    return query
        select json_build_object('user_id', s.user_id, 'role', s.role, 'added_by', s.added_by, 'created_at', s.created_at)
        from public.staff s
        order by case s.role when 'owner' then 0 when 'dev' then 1 else 2 end, s.created_at;
end;
$$;

-- Adds someone as dev or mod, or changes their role
create or replace function public.staff_set(caller_id text, target_user_id text, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller public.staff := public.require_staff(caller_id, 'dev');
begin
    if new_role not in ('dev', 'mod') then
        raise exception 'Role must be dev or mod';
    end if;
    if target_user_id = caller.user_id then
        raise exception 'You can''t change your own role';
    end if;
    if exists (select 1 from public.staff where user_id = target_user_id and role = 'owner') then
        raise exception 'The owner''s role can''t be changed';
    end if;

    insert into public.staff (user_id, role, added_by)
    values (target_user_id, new_role, caller.user_id)
    on conflict (user_id) do update set role = excluded.role, added_by = excluded.added_by;
end;
$$;

create or replace function public.staff_remove(caller_id text, target_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller public.staff := public.require_staff(caller_id, 'dev');
begin
    if target_user_id = caller.user_id then
        raise exception 'You can''t remove yourself';
    end if;
    delete from public.staff where user_id = target_user_id and role <> 'owner';
end;
$$;

-- Reports

create or replace function public.report_create(caller_id text, target_user_id text, report_reason text, content text default null, link text default null, proof text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller public.staff := public.require_staff(caller_id, 'mod');
begin
    -- Message reports include the message itself; user reports need a screenshot as proof
    if link is null and proof is null then
        raise exception 'Add an image as proof for the report';
    end if;

    insert into public.reports (reported_user_id, reporter_id, reason, message_content, message_link, proof_image)
    values (target_user_id, caller.user_id, report_reason, content, link, proof);
end;
$$;

create or replace function public.reports_list(caller_id text)
returns setof json
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_staff(caller_id, 'dev');
    return query
        select row_to_json(r) from public.reports r
        where r.status = 'open'
        order by r.created_at desc;
end;
$$;

create or replace function public.report_dismiss(caller_id text, target_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller public.staff := public.require_staff(caller_id, 'dev');
begin
    update public.reports set status = 'dismissed', handled_by = caller.user_id, handled_at = now()
    where id = target_report_id;
end;
$$;

-- Bans

create or replace function public.ban_add(caller_id text, target_user_id text, ban_reason text, duration_minutes integer default null, from_report_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller public.staff := public.require_staff(caller_id, 'dev');
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

    -- Banned mods lose their role
    delete from public.staff where user_id = target_user_id and role = 'mod';

    -- Close every open report about them
    update public.reports set status = 'banned', handled_by = caller.user_id, handled_at = now()
    where status = 'open' and (reported_user_id = target_user_id or id = from_report_id);
end;
$$;

create or replace function public.ban_remove(caller_id text, target_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_staff(caller_id, 'dev');
    delete from public.bans where user_id = target_user_id;
end;
$$;

create or replace function public.bans_list(caller_id text)
returns setof json
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_staff(caller_id, 'dev');
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
    public.staff_role(text),
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
