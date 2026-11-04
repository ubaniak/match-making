-- Migration 49 (Bhavek, 2026-11-04): "only the CO and deputy can invite other officials.
-- Ordinary ones can only change their role in an event".
--
--   * Replaces migration 24's rule that any official who accepted an event could invite more
--     officials. Now only the event's Chief Official and Deputy (and site Admins, who keep all
--     powers) can invite officials, add new officials by name and email, and resend invitations.
--   * Ordinary officials can still answer their own invitation and change their own days and roles
--     (Judge, Referee, Supervisor, Timekeeper) with respond_to_invitation. That is unchanged.
--   * Ordinary officials who accepted still see the event's officials lists (read-only).
--
-- can_add_officials gates list_invitable_officials, invite_officials, add_event_official,
-- official_invitation_email and welcome_email_details, so changing it covers all of them.
-- is_event_chief is true for both Chief Official seats ('chief' and 'deputy').

create or replace function public.can_add_officials(p_event_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_site_admin() or public.is_event_chief(p_event_id)
$$;
