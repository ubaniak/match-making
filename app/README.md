# Match Making app

React (Vite) app on Supabase. People sign in with an emailed link, and Admins add coaches and athletes from the Admin page. See [../plan/rbac.md](../plan/rbac.md) for the roles and permissions.

## Supabase setup

1. Create a Supabase project.
2. In the SQL Editor, run [`../supabase/migrations/20261008000000_rbac_and_athletes.sql`](../supabase/migrations/20261008000000_rbac_and_athletes.sql). It creates the roles, profiles, invites and athletes tables with their access rules. (Or use the Supabase CLI: `supabase link` then `supabase db push`.)
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
