# Match Making app

React (Vite) app on Supabase. People sign in with an emailed link, and Admins add users and athletes from the Admin page. See [../plan/rbac.md](../plan/rbac.md) for the roles and permissions.

## Demo mode

Until the Supabase values are set, the app runs in demo mode: no Supabase needed, sample users and athletes, and only one demo admin account can sign in. Anything you add is saved in that browser only, and "Reset sample data" puts the samples back. The "Viewing as" menu in the demo banner switches to one of the sample users, so you can see what an event Owner, Coach or Viewer sees.

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
   8. [`20261101000000_event_lifecycle.sql`](../supabase/migrations/20261101000000_event_lifecycle.sql): event statuses (Requested, Active, Done, Cancelled), only site Admins create events, weigh-in windows and bout sessions, posters, the public page, and no more event-level Admin
   9. [`20261101010000_clubs.sql`](../supabase/migrations/20261101010000_clubs.sql): clubs, club Owners and Coaches, invites approved by a site Admin, athletes linked to a club (existing club names become clubs), and transfer requests
   10. [`20261101020000_entries.sql`](../supabase/migrations/20261101020000_entries.sql): clubs joining events (invites and join requests), entering and withdrawing athletes, suggested opponents, the entry deadline and late-entry requests; event Coaches become Viewers
   11. [`20261101030000_event_timezones.sql`](../supabase/migrations/20261101030000_event_timezones.sql): each event has a time zone (picked by the site Admin; existing events get America/Winnipeg), and "today" for an event is today in its time zone, so events stay open and listed until local midnight; the Done job runs hourly
   12. [`20261101040000_bouts.sql`](../supabase/migrations/20261101040000_bouts.sql): bout matching: each event's Chief Official and Deputy, bouts with corner and official approvals, comments, the weigh-in and medicals, card order and results (a result adds one to both boxers' bout counts)
   13. [`20261101050000_delete_athletes.sql`](../supabase/migrations/20261101050000_delete_athletes.sql): Club Owners and site Admins can delete athletes, except one entered in an Active event (withdraw them first) or one with a recorded bout result

   Each file only runs once; running one again gives "already exists" errors. (With the Supabase CLI you can instead run `supabase link` then `supabase db push` from the repo root.)
3. **Make yourself the site Admin.** Still in the SQL Editor, run this with your own email in lowercase, before you sign in for the first time:

   ```sql
   insert into invites (email, role_id) values ('you@example.com', 'admin');
   ```

   When that email first signs in, it becomes an Admin. If you've already signed in once, run this instead:

   ```sql
   update profiles set role_id = 'admin' where email = 'you@example.com';
   ```
4. **Turn on email sign-in.** Under Authentication > Sign In / Providers, check that Email is enabled (it is by default). The app emails a 6-digit code plus a link (either one signs you in), so no password settings matter. Google sign-in is optional; see "Google sign-in" below.
5. **Allow the GitHub Pages address.** Under Authentication > URL Configuration:
   - Set **Site URL** to `https://ubaniak.github.io/match-making/`
   - Under **Redirect URLs**, add `https://ubaniak.github.io/match-making/**` and, for local dev, `http://localhost:5173/**`

   Without these, the link in the sign-in email sends people to `localhost` or gets rejected.
6. **Copy the URL and key.** Click Connect at the top of the project (or go to Project Settings > API Keys and Project Settings > Data API). You need the **Project URL** (`https://<ref>.supabase.co`) and the **anon / publishable key** (`eyJ...` on the Legacy API keys tab, or `sb_publishable_...`). Either key works. Never use the `service_role` or secret key: it skips all the access rules.
7. **Give them to GitHub.** In the repo, go to Settings > Secrets and variables > Actions, open the **Variables** tab (not Secrets), and add:
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the anon / publishable key

   They're variables rather than secrets because the key ends up in the page's JavaScript anyway; it's safe to share because row-level security protects the data. Then rebuild the site: Actions > Deploy to GitHub Pages > Run workflow on `main` (or push any commit). Demo mode switches off once the new build is live.
8. **Sign in.** Open https://ubaniak.github.io/match-making/, enter your email, and type the code from the email (or click its link). You should see the Admin tab.

Supabase's built-in email sender only allows a few emails an hour, which is fine for testing. Before real users rely on it, add your own SMTP server under Authentication > Emails > SMTP Settings. If a sign-in email doesn't arrive, check spam, then Authentication > Users and the project's Auth logs.

## Who can do what

- **Site Admins** see the Admin page. Adding a user saves their email; when that email first signs in, it gets a User account. If the person has already signed in, they become a User straight away.
- Every **athlete** needs a name, date of birth, gender (male or female), weight in kg, experience (number of bouts) and a club from the Clubs page; email is optional. In the CSV import the `club` column must match an existing club's name. Adding an athlete with an email does the same with the Athletes role, and links the athlete record to that login.
- Adding an **official** works the same way with the Officials role. Officials, like users, must have an email; only athletes can be added without one.
- Each tab can also **bulk add from a CSV file**. "Download template" gives the expected columns; after choosing a file you see every row with any problems (missing name, bad email or date, unknown coach, repeated email), and only the rows without problems are added. Athletes are matched to their coach by `coach_email` (any user), who must have signed in already.
- **Clubs** (the Clubs tab) follow [plan/events.md](../plan/events.md), section 2:
  - A **site Admin** creates clubs and adds their **Owners**. Owners invite more people as Owner or Coach, and each invite waits until a site Admin approves it (the Clubs page lists them). One person can be in many clubs.
  - **Owners** (and site Admins) add and edit the club's athletes. **Coaches** see them.
  - An athlete is in one club at a time. A member of their club sends a **transfer request** to another club; that club's Owner accepts or declines. A site Admin can also **move** an athlete straight away. Bout count and history stay with the athlete.
  - Athletes entered in an **Active** event can't change clubs until it's Done; a site Admin can override.
- **Events** follow [plan/events.md](../plan/events.md):
  - Only a **site Admin** creates an event (name, dates, optional location, Owner). It starts as **Requested** and the Owner is emailed "You have Requested an event" (see [Owner emails](#owner-emails)).
  - The **Owner** edits the details, uploads an optional poster, and sets each day's times: one weigh-in (start and end, at least 2 hours, ending at least 3 hours before that day's first bout) and one or more bout sessions. Days can be left without bouts. The app refuses times that break the rules.
  - A site Admin **approves** the event (Active) at any time, **cancels** it, or **marks it Done**. Events also turn Done by themselves the day after their end date. Only site Admins change the Owner; the old Owner stays on as a Viewer.
  - Once an event is **Active**, the Owner (or a site Admin) **invites clubs**, and club owners can **ask to join**; the Owner accepts or declines. Club owners then **enter their own athletes** straight away, optionally suggesting an opponent by name and club, and can **withdraw** them any time before the event is Done.
  - The Owner can set an optional **entry deadline**. After it, club owners send a **late-entry request** instead, which the Owner accepts or declines.
  - Every signed-in user can see Active and Done events. Entries are seen only by the Owner, site Admins and members of clubs that are in. The Owner can also add **Viewers**, who see the event but not its entries. There is no event-level Admin.
  - Each event has a **Chief Official** and a **Deputy**, chosen by the Owner or a site Admin. The Owner **matches bouts** from the entered athletes; the app blocks pairings outside the age, weight and experience allowances (`app/src/matching.js`) and shows the gaps inside them. A bout needs approval from **both corners' club owners** and **the Chief Official or Deputy**; a rejection sends it back to the Owner to re-match. Everyone involved can **comment**.
  - On weigh-in day the Chief Official or Deputy records each boxer's **weight and medical**. A failed medical or a no-show cancels that boxer's bouts that day, and so does a weight that no longer fits. Once a day's weigh-in has started, only the officials make or change that day's bouts, and they can approve for a corner.
  - The Owner sets the **order and session** of each bout; the card stays editable until the event is Done. The officials record **results**, which add one to both boxers' bout counts.
  - The **public page** (`#upcoming`, linked from the sign-in page) lists upcoming Active events with their location, poster and times, with no sign-in. It never shows people or athletes.
- Anyone else who signs in gets the Public role and sees a holding page until an Admin adds them.

The rules are enforced by row-level security in the database, not just hidden in the app.

## Sign-in emails

Supabase's built-in mailer sends only about 2 emails an hour. Turn on custom SMTP under Authentication > SMTP Settings (Resend: host `smtp.resend.com`, port `465`, username `resend`, an API key as the password), then raise the email limit under Authentication > Rate Limits. With custom SMTP you can also set the sender name, for example "Match Making".

The email wording lives in `supabase/templates/`. In Authentication > Emails, paste each file's contents into the matching template:

| File | Template | Subject |
| --- | --- | --- |
| `magic_link.html` | Magic Link | Your Match Making sign-in code |
| `confirm_signup.html` | Confirm signup | Welcome to Match Making |

Each email shows a 6-digit code and a sign-in link. The code is what the sign-in page asks for, and it works when the email is opened on a different device. The link still works too, which is handy in development. If the emails show a link but no code, the templates haven't been pasted in yet. Code length is set under Authentication > Sign In / Providers > Email > Email OTP Length (keep it at 6).

## Google sign-in

The "Continue with Google" button stays hidden until you finish these steps. Invites, officials and athletes still match people by email, and Google only ever hands over a verified address, so nothing else changes. Someone who first signed in by email and later uses Google with the same address lands in the same account.

1. **Create the Google client.** In [Google Cloud Console](https://console.cloud.google.com/), create a project (or pick one), then go to APIs & Services > OAuth consent screen (Google Auth Platform):
   - App name `Match Making`, your email as support and developer contact.
   - Audience: **External**. Scopes: just the defaults (`email`, `profile`, `openid`).
   - Publish the app (Audience > Publish app). While it's in "Testing", only test users you list can sign in.
2. **Make the credentials.** APIs & Services > Credentials > Create credentials > OAuth client ID:
   - Application type **Web application**.
   - Authorized JavaScript origins: `https://ubaniak.github.io` and `http://localhost:5173`
   - Authorized redirect URIs: `https://lybhzxdqdsqtwsxmolcg.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client secret**.
3. **Turn it on in Supabase.** Authentication > Sign In / Providers > Google: enable it and paste the Client ID and Client secret. Save. (The Redirect URLs from step 5 above already cover where Google sends people back.)
4. **Show the button.** In GitHub, Settings > Secrets and variables > Actions > Variables, add `VITE_GOOGLE_SIGN_IN` = `true`, then rerun the Deploy to GitHub Pages workflow. For local dev, put `VITE_GOOGLE_SIGN_IN=true` in `app/.env.local`.

Google sign-in sends no email, so it isn't affected by the email rate limit.

## Owner emails

When a site Admin creates an event, the app asks the `send-event-email` Edge Function to email the Owner. Until that's set up, the event page says the email wasn't sent and offers a "Send it from your email app" link with the message filled in, so nothing is blocked. To send it automatically:

1. Make a free account at https://resend.com and create an API key. To send to anyone, verify your own domain there; without one, Resend only delivers to your own address.
2. In Supabase, open Edge Functions > Deploy a new function > Via editor, name it `send-event-email`, paste in [`supabase/functions/send-event-email/index.ts`](../supabase/functions/send-event-email/index.ts), and deploy. (Or `supabase functions deploy send-event-email` with the CLI.)
3. Under Edge Functions > Secrets add `RESEND_API_KEY`, and `EMAIL_FROM` (e.g. `Match Making <events@your-domain>`) once your domain is verified.

## Done job

`close_finished_events()` runs at 5 past every hour with pg_cron (migration 11), so each event turns Done soon after midnight in its own time zone. If the migration printed a notice that pg_cron wasn't available, turn it on under Database > Extensions and run the `cron.schedule` line from that notice. Until then the app still shows past events as Done.

## Run locally

```sh
cp .env.example .env.local   # then fill in the Supabase URL and anon key
npm install
npm run dev                  # opens http://localhost:5173/
```

## Deploy

Every push to `main` builds the app and publishes it to GitHub Pages at https://ubaniak.github.io/match-making/ through `.github/workflows/deploy.yml`. The build reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the repository's Actions variables.
