-- Chordline community features: profile extras and announcements
-- Run this AFTER chordline-staff.sql: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- It is safe to run again.
--
-- Like staff, people are identified by the Discord user ID their Chordline sends, which the database can't verify.

-- "Uses Chordline" now comes from Discord itself ("Playing Chordline" activity), so the old check-in table is removed
drop function if exists public.chordline_ping(text, text, boolean);
drop function if exists public.chordline_users_list();
drop table if exists public.chordline_users;

-- Custom profile banner and colors, shown to other Chordline users
create table if not exists public.profile_extras (
    user_id text primary key check (user_id ~ '^[0-9]{15,21}$'),
    banner text check (banner is null or (banner ~ '^data:image/(png|jpeg|webp|gif);base64,' and char_length(banner) <= 1500000)),
    -- colors as 0xRRGGBB numbers, like Discord's profile theme colors
    primary_color integer check (primary_color between 0 and 16777215),
    accent_color integer check (accent_color between 0 and 16777215),
    updated_at timestamptz not null default now()
);

create table if not exists public.announcements (
    id uuid primary key default gen_random_uuid(),
    title text not null check (char_length(title) between 1 and 100),
    body text not null check (char_length(body) between 1 and 2000),
    created_by text not null,
    created_at timestamptz not null default now()
);

alter table public.profile_extras enable row level security;
alter table public.announcements enable row level security;

-- Profile extras

create or replace function public.profile_extras_list()
returns setof json
language sql
stable
security definer
set search_path = ''
as $$
    select json_build_object(
        'user_id', p.user_id,
        'primary_color', p.primary_color,
        'accent_color', p.accent_color,
        'has_banner', p.banner is not null,
        'updated_at', p.updated_at
    )
    from public.profile_extras p;
$$;

create or replace function public.profile_banner(target_user_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select banner from public.profile_extras where user_id = target_user_id;
$$;

create or replace function public.save_profile_extras(caller_id text, banner text, primary_color integer, accent_color integer)
returns void
language sql
security definer
set search_path = ''
as $$
    insert into public.profile_extras (user_id, banner, primary_color, accent_color, updated_at)
    values (caller_id, banner, primary_color, accent_color, now())
    on conflict (user_id) do update
        set banner = excluded.banner, primary_color = excluded.primary_color,
            accent_color = excluded.accent_color, updated_at = now();
$$;

-- Announcements (posted by devs and the owner)

create or replace function public.announcements_list()
returns setof json
language sql
stable
security definer
set search_path = ''
as $$
    select row_to_json(a) from public.announcements a
    where a.created_at > now() - interval '30 days'
    order by a.created_at desc
    limit 20;
$$;

create or replace function public.announcement_create(caller_id text, announcement_title text, announcement_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller public.staff := public.require_staff(caller_id, 'dev');
begin
    insert into public.announcements (title, body, created_by)
    values (announcement_title, announcement_body, caller.user_id);
end;
$$;

create or replace function public.announcement_delete(caller_id text, announcement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform public.require_staff(caller_id, 'dev');
    delete from public.announcements where id = announcement_id;
end;
$$;

grant execute on function
    public.profile_extras_list(),
    public.profile_banner(text),
    public.save_profile_extras(text, text, integer, integer),
    public.announcements_list(),
    public.announcement_create(text, text, text),
    public.announcement_delete(text, uuid)
to anon, authenticated;

notify pgrst, 'reload schema';
