-- Officials must have an email, like users. Only athletes can be added without one.
-- NOT VALID: officials already saved without an email are left alone, but any new official,
-- or any edit to an existing one, needs an email. Find the ones to fix with:
--   select id, name from officials where invite_email is null;
alter table public.officials
  add constraint officials_email_required check (invite_email is not null and invite_email <> '') not valid;
