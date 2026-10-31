-- Athletes need a name, date of birth, gender, weight, experience and club.
--   gender      'male' or 'female' (the competition categories)
--   weight_kg   current weight in kilograms, e.g. 63.5
--   bouts       experience, as the number of bouts the athlete has had
-- weight_class stays in the table for anything already saved, but the app no longer asks for it.
--
-- The checks are NOT VALID: athletes already saved with missing details are left alone, but any
-- new athlete, or any edit to an existing one, needs all six. Find the ones to fill in with:
--   select id, name from athletes
--   where date_of_birth is null or gender is null or weight_kg is null or bouts is null or club is null;

alter table public.athletes
  add column gender text check (gender in ('male', 'female')),
  add column weight_kg numeric(5, 2) check (weight_kg between 20 and 200),
  add column bouts integer check (bouts between 0 and 1000);

alter table public.athletes
  add constraint athletes_details_required check (
    date_of_birth is not null
    and gender is not null
    and weight_kg is not null
    and bouts is not null
    and club is not null and length(trim(club)) > 0
  ) not valid;
