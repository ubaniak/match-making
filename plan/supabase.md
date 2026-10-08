# Supabase plan

All app data, files and sign-in live in one Supabase project. The React app talks to it with `@supabase/supabase-js`, and row-level security (RLS) applies the role rules from [rbac.md](rbac.md) to every request. Nobody edits the data outside the app, so there is no need for Google Drive or Sheets.

## Setup

1. Create a Supabase project. Use one project for development and a second for production once real people use the app.
2. In Google Cloud, create an OAuth client (type Web application) and add Supabase's callback URL as a redirect URI.
3. In Supabase, go to Authentication > Providers > Google and paste the client ID and secret.
4. Add the app's URLs (local dev and production) under Authentication > URL Configuration.
5. Keep the schema in the repo as migrations (`supabase/migrations/*.sql`) and apply them with the Supabase CLI (`supabase db push`), so both projects stay identical.

The React app needs only two settings, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Both are safe to ship to the browser because RLS does the protecting. The service role key stays in Edge Functions.

## Schema

The RBAC tables (`roles`, `role_permissions`, `profiles`, `invites`, `audit_log`) are in [rbac.md](rbac.md). The app's own tables:

| Table | Main columns | Ownership columns used by RLS |
| --- | --- | --- |
| `athletes` | `id`, `name`, `date_of_birth`, `weight_class`, `record`, `photo_path` | `coach_id`, `user_id`, `invite_email` |
| `officials` | `id`, `name`, `qualifications`, `photo_path` | `user_id` |
| `cards` | `id`, `title`, `event_date`, `venue`, `status`, `is_public` | `owner_id` |
| `card_submissions` | `id`, `card_id`, `kind` (`official` or `athlete`), `official_id`, `athlete_id`, `status` (`pending`, `accepted`, `declined`) | `submitted_by`, plus the card's `owner_id` |
| `bouts` | `id`, `card_id`, `red_athlete_id`, `blue_athlete_id`, `weight_class`, `rounds`, `result` | the card's `owner_id` |
| `documents` | `id`, `athlete_id` or `official_id`, `kind`, `storage_path`, `uploaded_by` | the profile's owner |

Every table also has `created_at`, `updated_at` and `updated_by`. Foreign keys tie submissions and bouts to cards, so deleting a card can't leave stray rows.

**Linking athletes to their login.** When a coach adds an athlete they can fill in `invite_email`. When someone signs in with that Google email, the sign-in trigger sets `athletes.user_id` to their account and gives them the Athletes role.

## Policies

Each table gets one policy per action, built on `has_permission` from [rbac.md](rbac.md). Examples:

```sql
-- anyone, including signed-out visitors, can read public cards
create policy "read public cards" on cards for select to anon, authenticated
  using (is_public);

-- members read all cards
create policy "read cards" on cards for select to authenticated
  using (has_permission('cards:read'));

-- a coach submits only their own athletes, and only to cards that are open
create policy "submit athlete" on card_submissions for insert to authenticated
  with check (
    kind = 'athlete'
    and has_permission('cards:submit-athlete', (select coach_id from athletes where id = athlete_id))
    and (select status from cards where id = card_id) = 'open'
  );

-- only the card's owner accepts or declines
create policy "decide submission" on card_submissions for update to authenticated
  using (has_permission('cards:manage', (select owner_id from cards where id = card_id)));
```

`has_permission` is a `stable security definer` function, so it can read the role tables without exposing them, and Postgres caches its answer within a query.

## Files

Two private Storage buckets, `athlete-files` and `official-files`. Files are stored under the profile's id (`athlete-files/<athlete_id>/<file>`), and Storage policies run the same `has_permission` check on that id. The app shows files through short-lived signed URLs, so a copied link stops working after a few minutes.

## Admin-only actions

Most admin work is plain table edits protected by RLS (`users:manage`, `roles:manage`). Two things run as database triggers instead:

- the sign-in trigger that creates profiles, applies invites and makes the owner email an Admin
- the guard that stops the last active Admin being demoted or disabled

An Edge Function is needed only for actions that require the service role key, such as signing a user out everywhere when they're disabled.

## Cost and limits

- **Free plan:** enough to build and test on. Free projects pause after a week with no activity, and don't include automatic backups you can restore from.
- **Pro plan:** about $25 a month per organization. Projects don't pause and daily backups are included. Move to it before real users rely on the app.
- Check current limits on Supabase's pricing page before launch; these figures are from memory.

## Open questions

- [ ] Which fields does an athlete profile need (for example weight, record, club, medical expiry)?
- [ ] Should results be recorded on bouts by the card owner, or by an Admin only?
