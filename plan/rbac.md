# RBAC plan

Users sign in with Google through Supabase Auth. Roles and permissions live in Postgres tables, and row-level security (RLS) policies check them on every read and write, so the rules hold even if the React app has a bug. The React app only hides what a user can't use. Storage, schema and setup are in [supabase.md](supabase.md).

## Architecture

```text
React app  --supabase-js-->  Supabase
    |                          Auth (Google sign-in)
    |                          Postgres + RLS policies   <- roles, permissions, app data
    |                          Storage + policies        <- photos, documents
    |                          Edge Functions            <- the few admin-only actions
```

- **Front end:** React (Vite) using `@supabase/supabase-js`. Talks to Supabase directly with the public anon key; RLS decides what each request may do.
- **No custom backend server.** Rules that need more than RLS (for example "never remove the last Admin") are database triggers. Anything that needs the secret service key runs in a Supabase Edge Function.
- **Auth:** Google sign-in via Supabase Auth.
- **RBAC data:** `roles`, `role_permissions` and `profiles` tables, edited through an Admins-only screen.

## Roles

| Role | Who | What they can do |
| --- | --- | --- |
| Admins | App owners | Everything: view and edit any data, give and remove access, change what each role can do. |
| Officials | Referees, judges, other officials | View member pages, keep their own profile and documents up to date, put their name forward for cards. |
| Coaches | Coaches | Create and run their own cards, add and edit their athletes, put athletes forward for cards. |
| Athletes | Boxers | Edit their own profile and documents, view cards. |
| Public | Anyone, signed in or not | Read-only access to public pages. |

A **card** is an event's list of bouts. The coach who creates a card owns it and decides which submitted officials and athletes go on it.

## Permissions

Permissions are named `area:action`. The list is fixed in the database schema, because each one is checked by an RLS policy; Admins decide which role gets which from the admin screen. Each grant has a scope:

- **Any:** every record.
- **Own:** records the user created or is responsible for (a coach's cards and athletes).
- **Self:** the user's own profile record.

The table is the starting default.

| Permission | What it allows | Admins | Officials | Coaches | Athletes | Public |
| --- | --- | --- | --- | --- | --- | --- |
| `public:read` | View public pages | Any | Any | Any | Any | Any |
| `pages:read` | View member pages | Any | Any | Any | Any | No |
| `cards:read` | View cards and their bouts | Any | Any | Any | Any | Public cards only |
| `cards:create` | Create a card (creator becomes owner) | Any | No | Any | No | No |
| `cards:manage` | Edit a card, accept or decline submissions, set bouts | Any | No | Own | No | No |
| `cards:submit-official` | Put an official's name forward for a card | Any | Self | No | No | No |
| `cards:submit-athlete` | Put an athlete's name forward for a card | Any | No | Own | No | No |
| `athletes:read` | View athlete profiles | Any | Any | Any | Any | No |
| `athletes:create` | Add an athlete | Any | No | Any | No | No |
| `athletes:write` | Edit an athlete's profile | Any | No | Own | Self | No |
| `officials:read` | View official profiles | Any | Any | Any | No | No |
| `officials:write` | Edit an official's profile | Any | Self | No | No | No |
| `files:upload` | Upload documents and photos to a profile | Any | Self | Own | Self | No |
| `users:manage` | Invite users, change their role, remove access | Any | No | No | No | No |
| `roles:manage` | Create roles, edit role permissions | Any | No | No | No | No |
| `audit:read` | See who changed what | Any | No | No | No | No |

- **Admins** always hold every permission. The `has_permission` function returns true for Admins before it looks at any grants, so nobody can lock themselves out by editing the Admins role.
- **Public** covers visitors who aren't signed in (Supabase's `anon` role) and signed-in accounts that haven't been given a role yet.
- Extra roles can be created later by picking permissions from the same list.

## Data model

| Table | Columns | Notes |
| --- | --- | --- |
| `roles` | `id`, `name`, `description`, `is_system` | `is_system` marks the five built-in roles so they can't be deleted. |
| `role_permissions` | `role_id`, `permission`, `scope` | `scope` is `any`, `own` or `self`. One row per grant. |
| `profiles` | `id` (= `auth.users.id`), `email`, `name`, `role_id`, `status` | Created by a trigger on first sign-in. `status` is `active` or `disabled`. |
| `invites` | `email`, `role_id`, `invited_by`, `created_at` | An Admin adds a row; on that person's first Google sign-in the trigger gives them this role. |
| `audit_log` | `at`, `actor_id`, `action`, `table_name`, `record_id`, `details` | Written by triggers on every change; nobody can edit it. |

Ownership columns on the app's tables (full schema in [supabase.md](supabase.md)) are what the `own` and `self` scopes check:

- `athletes.coach_id` (the coach who added them) and `athletes.user_id` (the athlete's own login, if they have one)
- `officials.user_id`
- `cards.owner_id`
- `card_submissions.submitted_by`

One owner email is set as a database setting. That account is always made an Admin on sign-in, which is the way back in if the role tables are ever edited badly.

## Sign-in

1. The React app calls `supabase.auth.signInWithOAuth({ provider: 'google' })`. Public pages work without signing in.
2. Supabase handles the Google redirect and returns a session to the app; supabase-js keeps it refreshed.
3. On a user's first sign-in, a trigger on `auth.users` creates their `profiles` row. If their email is in `invites`, they get that role; otherwise they get Public.
4. The app reads the user's profile and permission list (a `my_permissions()` database function) to decide what to show.

Permissions are read from the tables on every request, not stored in the login token, so a role change takes effect immediately without signing out.

## Enforcement

**Database.** One SQL function answers every permission question:

```sql
-- true when the signed-in user holds `perm` with a scope that covers this record
has_permission(perm text, owner uuid default null) returns boolean
```

It returns true for Admins; otherwise it looks up the user's role in `role_permissions` and checks the scope: `any` always passes, while `own` and `self` pass only when `owner` equals `auth.uid()`. RLS policies call it:

```sql
create policy "edit athletes" on athletes for update using (
  has_permission('athletes:write', coach_id)   -- coaches: own
  or has_permission('athletes:write', user_id) -- athletes: self
);
```

A disabled profile fails every check.

**React.** An `AuthProvider` loads the session and `my_permissions()` once and exposes them.

- `<Can permission="cards:manage">…</Can>` shows its children only when the user holds that permission. Use it for buttons and menu items.
- `<RequirePermission permission="users:manage">` wraps whole routes and shows a "no access" page otherwise.

A pgTAP test suite signs in as each default role and checks every table's read, insert, update and delete against the matrix above, so a missing policy is caught before it ships.

## Admin screens

| Page | What an Admin can do |
| --- | --- |
| Users | Invite someone by Google email and pick their role; change a role; disable or re-enable an account. |
| Roles | See a grid of every permission against every role, set each cell to Any, Own, Self or none; create a role; delete a custom role nobody holds. |
| Activity | Browse the audit log, filtered by person, area or date. |

Safety rules, enforced by triggers: the last active Admin can't be demoted or disabled, and the Admins role's grants can't be edited.

## Security checklist

- [ ] RLS is turned on for every table, with no table left open by default.
- [ ] The service role key is used only inside Edge Functions, never in the React bundle or the repo.
- [ ] Public (`anon`) policies expose only public cards and the fields public pages need, no contact details or documents.
- [ ] Storage buckets are private, with policies matching the table rules.
- [ ] Every policy is covered by the role-matrix test.
- [ ] Every change is logged in `audit_log`.

## Build order

1. **Supabase setup.** Create the project, turn on Google sign-in, create the role tables and `has_permission`, and add the owner email. Check: sign in and see yourself as Admin.
2. **React shell.** Sign-in, `AuthProvider`, `<Can>`, `<RequirePermission>`. Check: a fresh Google account signs in as Public.
3. **Athletes.** Table, policies, Athletes screen. Check: a coach adds an athlete; the athlete signs in and edits only their own profile.
4. **Admin screens.** Users, Roles grid, Activity. Check: change a role's permissions and see that user's screen change on reload.
5. **Officials and cards.** Official profiles, card creation, submissions, owner accepts or declines.
6. **Files.** Storage buckets and uploads on profiles.
7. **Hardening and deploy.** Role-matrix tests, then deploy the React app as a static site (for example Vercel or Netlify).

## Open questions

- [ ] What should Public see: only upcoming public cards and results, or also athlete profiles? The default above is public cards only.
- [ ] Who accepts an official's or athlete's submission to a card: only the card's owning coach, or Admins too? The default is the owner, with Admins able to override.
- [ ] Can a coach edit athletes added by another coach, or only their own? The default is only their own.
- [ ] How does an athlete get linked to their profile: the coach enters the athlete's Google email when adding them, or the athlete claims the profile and the coach approves? The default is the coach enters it.
- [ ] Can Officials see athlete profiles, and can Athletes see official profiles? The default is Officials yes, Athletes no.
- [ ] How do new people get in: invite-only by an Admin, or sign in as Public and ask for a role? The default is both: invited emails get their role at once, anyone else starts as Public.
