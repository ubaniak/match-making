-- Migration 40: Boxing Canada (BC) registration numbers, officials' levels and phones,
-- and each athlete's last medical date. All optional, so existing records are left alone.
--   officials.level        the official's level, a whole number (e.g. 1 to 5)
--   officials.phone        a phone number, stored as typed
--   officials.bc_number    Boxing Canada registration number (text, may hold letters)
--   athletes.bc_number     Boxing Canada registration number (text, may hold letters)
--   athletes.last_medical  the date of the athlete's last medical

alter table public.officials
  add column if not exists level integer check (level between 0 and 100),
  add column if not exists phone text check (phone is null or length(trim(phone)) between 1 and 40),
  add column if not exists bc_number text check (bc_number is null or length(trim(bc_number)) between 1 and 40);

alter table public.athletes
  add column if not exists bc_number text check (bc_number is null or length(trim(bc_number)) between 1 and 40),
  add column if not exists last_medical date;
