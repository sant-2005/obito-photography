-- ============================================================
-- OBITO PHOTOGRAPHY — Supabase Database Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- Project: metqwrjyhywsiherxctv
-- ============================================================

-- ── Drop existing tables if re-running ─────────────────────
drop table if exists public.bookings cascade;
drop table if exists public.customers cascade;

-- ── Bookings table ──────────────────────────────────────────
create table public.bookings (
  id               text primary key,
  "customerName"   text,
  phone            text,
  email            text,
  address          text,
  "eventType"      text,
  "eventDate"      text,
  "eventTime"      text,
  "eventDuration"  text,
  venue            text,
  city             text,
  state            text,
  "zipCode"        text,
  service          text,
  photographers    int  default 1,
  budget           int  default 0,
  advance          int  default 0,
  status           text default 'Pending',
  delivered        boolean default false,
  description      text,
  "createdAt"      text,
  "createdBy"      text,
  "updatedAt"      text,
  "updatedBy"      text
);

-- ── Customers table ─────────────────────────────────────────
create table public.customers (
  id               text primary key,
  "firstName"      text,
  "lastName"       text,
  phone            text,
  email            text,
  city             text,
  address          text,
  category         text default 'New',
  "totalBookings"  int  default 0,
  "totalRevenue"   int  default 0,
  "lastBookingId"  text,
  "lastBookingDate" text,
  "createdAt"      text,
  notes            text,
  "updatedAt"      text
);

-- ── Enable Row Level Security ───────────────────────────────
alter table public.bookings  enable row level security;
alter table public.customers enable row level security;

-- ── Open policies (allow all from browser with anon key) ───
-- (Lock these down with auth if you add Supabase Auth later)
create policy "Allow all on bookings"
  on public.bookings for all
  using (true)
  with check (true);

create policy "Allow all on customers"
  on public.customers for all
  using (true)
  with check (true);

-- ── Enable Realtime for both tables ────────────────────────
-- Go to: Supabase Dashboard → Database → Replication
-- Toggle ON: bookings, customers
-- OR run the commands below:
alter publication supabase_realtime add table public.bookings;
alter publication supabase_realtime add table public.customers;

-- ── Indexes for common queries ──────────────────────────────
create index if not exists idx_bookings_status    on public.bookings (status);
create index if not exists idx_bookings_eventdate on public.bookings ("eventDate");
create index if not exists idx_bookings_customer  on public.bookings ("customerName");
create index if not exists idx_customers_phone    on public.customers (phone);

-- ── Done! ───────────────────────────────────────────────────
-- Your Supabase database is ready for Obito Photography.