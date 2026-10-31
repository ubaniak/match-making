# Match Making app

React (Vite) app on Supabase. People sign in with an emailed link, and Admins add users and athletes from the Admin page. See [../plan/rbac.md](../plan/rbac.md) for the roles and permissions.

## Demo mode

Until the Supabase values are set, the app runs in demo mode: no Supabase needed, sample users and athletes, and only one demo admin account can sign in. Anything you add is saved in that browser only, and "Reset sample data" puts the samples back. The "Viewing as" menu in the demo banner switches to one of the sample users, so you can see what an event Owner, Admin, Coach or Viewer sees.

The demo login defaults to `admin@matchmaking.test` / `letmein`. Change it with the `VITE_MOCK_ADMIN_EMAIL` and `VITE_MOCK_ADMIN_PASSWORD` Actions variables (or in `.env.local`). The password is built into the page's JavaScript, so anyone determined can read it; demo mode keeps casual visitors out but doesn't protect real data.

Once `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, demo mode switches off and the real email sign-in below takes over.

## Supabase setup

Do these once, in this order. Everything is in the Supabase dashboard at https://supabase.com/dashboard except the last step, which is on GitHub.

1. **Create the project.** Click New project, pick a name (e.g. `match-making`), set a database password (save it somewhere, the app doesn't need it), choose the region closest to you, and wait a minute or two for it to start.
2. **Create the tables.** Open SQL Editor, start a new query, paste in the whole of each file below, and click Run. Run them one at a time, in this order, and check each says "Success" before moving on:
   1. [`20261008000000_rbac_and_athletes.sql`](../supabase/migrations/20261008000000_rbac_and_athletes.sql): roles, permissions, profiles, invites, athletes
   2. [`20261031000000_officials.sql`](../supabase/migrations/20261031000000_officials.sql): officials
   3. [`20261031120000_events.sql`](../supabase/migrations/20261031120000_events.sql): events, event days and event athletes
   4. [`20261031200000_event_roles.sql`](../supabase/migrations/20261031200000_event_roles.sql): turns Coaches into Users and adds per-event roles (Owner, Admin, Coach, Viewer)
   5. [`20261031210000_official_email_required.sql`](../supabase/migrations/20261031210000_official_email_required.sql): officials must have an email
   6. [`20261031220000_athlete_details.sql`](../supabase/migrations/20261031220000_athlete_details.sql): athletes need date of birth, gender, weight, experience (bouts) and club
   7. [`20261031230000_event_owner_on_create.sql`](../supabase/migrations/20261031230000_event_owner_on_create.sql): pick the Owner when creating an event

   Each file only runs once; running one again gives "already exists" errors. (With the Supabase CLI you can instead run `supabase link` then `supabase db push` from the repo root.)
3. **Make yourself the site Admin.** Still in the SQL Editor, run this with your own email in lowercase, before you sign in for the first time:

   ```sql
   insert into invites (email, role_id) values ('you@example.com', 'admin');
   ```

   When that email first signs in, it becomes an Admin. If you've already signed in once, run this instead:

   ```sql
   update profiles set role_id = 'admin' where email = 'you@example.com';
   ```
4. **Turn on the email link sign-in.** Under Authentication > Sign In / Providers, check that Email is enabled (it is by default). The app sends a magic link, so no password settings matter.
5. **Allow the GitHub Pages address.** Under Authentication > URL Configuration:
   - Set **Site URL** to `https://ubaniak.github.io/match-making/`
   - Under **Redirect URLs**, add `https://ubaniak.github.io/match-making/**` and, for local dev, `http://localhost:5173/**`

   Without these, the link in the sign-in email sends people to `localhost` or gets rejected.
6. **Copy the URL and key.** Click Connect at the top of the project (or go to Project Settings > API Keys and Project Settings > Data API). You need the **Project URL** (`https://<ref>.supabase.co`) and the **anon / publishable key** (`eyJ...` on the Legacy API keys tab, or `sb_publishable_...`). Either key works. Never use the `service_role` or secret key: it skips all the access rules.
7. **Give them to GitHub.** In the repo, go to Settings > Secrets and variables > Actions, open the **Variables** tab (not Secrets), and add:
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the anon / publishable key

   They're variables rather than secrets because the key ends up in the page's JavaScript anyway; it's safe to share because row-level security protects the data. Then rebuild the site: Actions > Deploy to GitHub Pages > Run workflow on `main` (or push any commit). Demo mode switches off once the new build is live.
8. **Sign in.** Open https://ubaniak.github.io/match-making/, enter your email, and click the link in the email. You should see the Admin tab.

Supabase's built-in email sender only allows a few emails an hour, which is fine for testing. Before real users rely on it, add your own SMTP server under Authentication > Emails > SMTP Settings. If a sign-in email doesn't arrive, check spam, then Authentication > Users and the project's Auth logs.

## Who can do what

- **Site Admins** see the Admin page. Adding a user saves their email; when that email first signs in, it gets a User account. If the person has already signed in, they become a User straight away.
- Every **athlete** needs a name, date of birth, gender (male or female), weight in kg, experience (number of bouts) and club; email is optional. Adding an athlete with an email does the same with the Athletes role, and links the athlete record to that login.
- Adding an **official** works the same way with the Officials role. Officials, like users, must have an email; only athletes can be added without one.
- Each tab can also **bulk add from a CSV file**. "Download template" gives the expected columns; after choosing a file you see every row with any problems (missing name, bad email or date, unknown coach, repeated email), and only the rows without problems are added. Athletes are matched to their coach by `coach_email` (any user), who must have signed in already.
- **Events**: any User can create an event (one day, or several days up to 31) and picks its **Owner**: themselves by default, or any other user, in which case the creator stays on as an Admin. Each day has its own weigh-in time and bout start time. People are added to an event with a role, and only see the events they're on:
  - **Owner**: one per event. Everything an Admin can do, plus delete the event and hand it to someone else with "Make owner" (the old Owner stays on as an Admin).
  - **Admin**: edit the event's details and times, add, change and remove people (not the Owner), and add or remove athletes.
  - **Coach**: add athletes (any athlete), and remove the ones they added.
  - **Viewer**: see the event, its schedule, athletes and people.
  Site Admins can see and do everything on every event.
- Anyone else who signs in gets the Public role and sees a holding page until an Admin adds them.

The rules are enforced by row-level security in the database, not just hidden in the app.

## Run locally

```sh
cp .env.example .env.local   # then fill in the Supabase URL and anon key
npm install
npm run dev                  # opens http://localhost:5173/
```

## Deploy

Every push to `main` builds the app and publishes it to GitHub Pages at https://ubaniak.github.io/match-making/ through `.github/workflows/deploy.yml`. The build reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the repository's Actions variables.
