-- Run this in Supabase: Project -> SQL Editor -> New query -> paste -> Run
-- If you already have an old "bookings" table from before, drop it first:
-- drop table if exists bookings;

create table bookings (
  id uuid primary key default gen_random_uuid(),
  name text,
  reason text,
  seat text,
  from_name text,
  from_lat float8,
  from_lon float8,
  to_name text,
  to_country text,
  to_iso2 text,
  to_lat float8,
  to_lon float8,
  created_at timestamptz default now()
);

alter table bookings enable row level security;

create policy "Public can read bookings"
  on bookings for select
  using (true);

create policy "Public can insert bookings"
  on bookings for insert
  with check (true);
