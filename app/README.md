# Match Making app

React (Vite) app on Supabase. People sign in with an emailed link, and Admins add coaches and athletes from the Admin page. See [../plan/rbac.md](../plan/rbac.md) for the roles and permissions.

## Demo mode

Until the Supabase values are set, the app runs in demo mode: no Supabase needed, sample coaches and athletes, and only one demo admin account can sign in. Anything you add is saved in that browser only, and "Reset sample data" puts the samples back. The "Viewing as" menu in the demo banner switches to one of the sample coaches, so you can see what a coach sees on the Events page.

The demo login defaults to `admin@matchmaking.test` / `letmein`. Change it with the `VITE_MOCK_ADMIN_EMAIL` and `VITE_MOCK_ADMIN_PASSWORD` Actions variables (or in `.env.local`). The password is built into the page's JavaScript, so anyone determined can read it; demo mode keeps casual visitors out but doesn't protect real data.

Once `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set, demo mode switches off and the real email sign-in below takes over.

## Supabase setup

1. Create a Supabase project.
2. In the SQL Editor, run each file in [`../supabase/migrations/`](../supabase/migrations/) in name order. They create the roles, profiles, invites, athletes, officials and events tables with their access rules. (Or use the Supabase CLI: `supabase link` then `supabase db push`.)
3. Make yourself the first Admin by running this in the SQL Editor with your own email, before you first sign in:

   ```sql
   insert into invites (email, role_id) values ('you@example.com', 'admin');
   ```

   If you've already signed in once, use `update profiles set role_id = 'admin' where email = 'you@example.com';` instead.
4. Under Authentication > URL Configuration, set the Site URL to `https://ubaniak.github.io/match-making/` and add `http://localhost:5173/**` to the Redirect URLs for local dev.
5. Email sign-in is on by default (Authentication > Providers > Email). Supabase's built-in email sender only allows a few emails an hour, which is fine for testing. Before real users rely on it, add your own SMTP server under Authentication > Emails > SMTP Settings.

## Who can do what

- **Admins** see the Admin page. Adding a coach saves their email; when that email first signs in, it becomes a coach. If the person has already signed in, they're made a coach straight away.
- Adding an **athlete** with an email does the same with the Athletes role, and links the athlete record to that login.
- Adding an **official** with an email works the same way with the Officials role.
- Each tab can also **bulk add from a CSV file**. "Download template" gives the expected columns; after choosing a file you see every row with any problems (missing name, bad email or date, unknown coach, repeated email), and only the rows without problems are added. Athletes are matched to coaches by `coach_email`, and the coach must have signed in already.
- **Events** are listed on the Events page for every signed-in member. An Admin creates an event (one day, or several days up to 31) and picks the coach who owns it. Each day has its own weigh-in time and bout start time. The owning coach can edit the event's name, venue, dates and times, and add or remove athletes (any athlete, not only their own). Only Admins can change the owner or delete an event.
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
