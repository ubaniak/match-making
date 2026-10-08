# Match Making app

React (Vite) app with Supabase Google sign-in. See [../plan/supabase.md](../plan/supabase.md) for the wider plan.

## Run locally

```sh
cp .env.example .env.local   # then fill in the Supabase URL and anon key
npm install
npm run dev                  # opens http://localhost:5173/match-making/
```

## Deploy

Every push to `main` builds the app and publishes it to GitHub Pages at https://ubaniak.github.io/match-making/ through `.github/workflows/deploy.yml`. The build reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the repository's Actions variables.
