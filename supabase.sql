-- คุยต่อ (GitHub Pages + Supabase) — ใช้ใน Supabase SQL Editor ครั้งเดียว
-- IMPORTANT: อ่าน README.md ก่อนรัน และเปิด Email Auth ใน Supabase Authentication
-- ฐานข้อมูลเปิด Data API ให้ authenticated role ตาม GRANT ด้านล่าง โดยใช้ RLS ทุกตาราง

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  invite_code uuid not null unique default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on public.room_members(user_id,room_id);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_room_id_id_desc_idx on public.messages(room_id,id desc);

create table if not exists public.devices (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null check(char_length(label) between 1 and 120),
  last_seen timestamptz not null default now(),
  primary key (user_id,id)
);

-- สร้าง profile ให้บัญชีใหม่โดยอัตโนมัติ
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,display_name)
  values(new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), 'สมาชิกใหม่'), 40))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ฟังก์ชันตรวจสิทธิ์ (SECURITY DEFINER กัน RLS recursion)
create or replace function public.is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;

-- RPC ทำงานด้วย auth.uid() แทนการอนุญาตให้ client เขียน rooms/members โดยตรง
create or replace function public.create_room(p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room uuid;
begin
  if v_user is null then raise exception 'Please sign in'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 then
    raise exception 'Room name must be 1-80 characters';
  end if;
  insert into public.rooms(title,created_by) values(btrim(p_title),v_user) returning id into v_room;
  insert into public.room_members(room_id,user_id) values(v_room,v_user);
  return v_room;
end;
$$;
revoke all on function public.create_room(text) from public, anon;
grant execute on function public.create_room(text) to authenticated;

create or replace function public.join_room(p_invite_code uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_room uuid;
begin
  if v_user is null then raise exception 'Please sign in'; end if;
  select id into v_room from public.rooms where invite_code = p_invite_code;
  if v_room is null then raise exception 'Invalid invitation code'; end if;
  insert into public.room_members(room_id,user_id) values(v_room,v_user)
  on conflict (room_id,user_id) do nothing;
  return v_room;
end;
$$;
revoke all on function public.join_room(uuid) from public, anon;
grant execute on function public.join_room(uuid) to authenticated;

-- เจ้าของห้องสามารถยกเลิกลิงก์เชิญเก่าและสร้างลิงก์ใหม่ได้
create or replace function public.rotate_invite_code(p_room_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_code uuid;
begin
  if v_user is null then raise exception 'Please sign in'; end if;
  update public.rooms set invite_code = gen_random_uuid()
    where id = p_room_id and created_by = v_user returning invite_code into v_code;
  if v_code is null then raise exception 'Only room owner can reset invite link'; end if;
  return v_code;
end;
$$;
revoke all on function public.rotate_invite_code(uuid) from public, anon;
grant execute on function public.rotate_invite_code(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;
alter table public.devices enable row level security;

-- profiles: เห็นชื่อตัวเองและคนในห้องเดียวกันเท่านั้น
DROP POLICY IF EXISTS "profiles_visible_to_shared_room" on public.profiles;
create policy "profiles_visible_to_shared_room" on public.profiles
for select to authenticated using (
  id = (select auth.uid()) or exists (
    select 1 from public.room_members rm
    where rm.user_id = profiles.id and public.is_room_member(rm.room_id)
  )
);

DROP POLICY IF EXISTS "rooms_read_members_only" on public.rooms;
create policy "rooms_read_members_only" on public.rooms
for select to authenticated using (public.is_room_member(id));

DROP POLICY IF EXISTS "members_read_room_members_only" on public.room_members;
create policy "members_read_room_members_only" on public.room_members
for select to authenticated using (public.is_room_member(room_id));

DROP POLICY IF EXISTS "messages_read_members_only" on public.messages;
create policy "messages_read_members_only" on public.messages
for select to authenticated using (public.is_room_member(room_id));

DROP POLICY IF EXISTS "messages_insert_members_only" on public.messages;
create policy "messages_insert_members_only" on public.messages
for insert to authenticated with check (
  sender_id = (select auth.uid()) and public.is_room_member(room_id)
);

DROP POLICY IF EXISTS "devices_read_own_only" on public.devices;
create policy "devices_read_own_only" on public.devices
for select to authenticated using (user_id = (select auth.uid()));
DROP POLICY IF EXISTS "devices_add_own_only" on public.devices;
create policy "devices_add_own_only" on public.devices
for insert to authenticated with check (user_id = (select auth.uid()));
DROP POLICY IF EXISTS "devices_update_own_only" on public.devices;
create policy "devices_update_own_only" on public.devices
for update to authenticated using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- ป้องกันการเขียนโดย anon; ให้สิทธิ์ขั้นต่ำกับบัญชีที่ล็อกอินแล้ว
revoke all on public.profiles,public.rooms,public.room_members,public.messages,public.devices from anon;
revoke all on public.profiles,public.rooms,public.room_members,public.messages,public.devices from authenticated;
grant select on public.profiles,public.rooms,public.room_members to authenticated;
grant select,insert on public.messages to authenticated;
grant select,insert,update on public.devices to authenticated;
-- หมายเหตุ: หากเปิดใช้ Supabase Data API Schema หรือ Grants แบบจำกัด ให้เปิด public schema ด้วย

-- Realtime แบบ postgres_changes: การอ่านข้อมูลยังถูกจำกัดด้วย RLS
-- ป้องกัน error หากรัน SQL ซ้ำ
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END;
$$;
