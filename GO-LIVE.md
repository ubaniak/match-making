# Go-live checklist

Work through this before real users sign in to https://ubaniak.github.io/match-making/. Tick each box as you go. The
detailed setup steps live in [app/README.md](app/README.md); this page only says what's left and where to look.

Status as of 4 November 2026.

## 1. Merge the open pull requests

These PRs are still open. Merge the ones you want live (or close the ones you don't):

- [ ] [#65](https://github.com/ubaniak/match-making/pull/65) Navy & Gold emails; invites show event dates, times and notes (migration 32)
- [ ] [#88](https://github.com/ubaniak/match-making/pull/88) Officials assignment tab (migration 47)
- [ ] [#89](https://github.com/ubaniak/match-making/pull/89) Rename the Admin nav tab to Members (no migration)
- [ ] [#92](https://github.com/ubaniak/match-making/pull/92) Only the Chief Official and Deputy invite officials (migration 49)
- [ ] [#93](https://github.com/ubaniak/match-making/pull/93) Event locations on Google Maps (migration 50, plus the Maps key in step 5)
- [ ] [#94](https://github.com/ubaniak/match-making/pull/94) Hide event officials from everyone but the Owner, officials and site Admins (migration 51)
- [ ] [#95](https://github.com/ubaniak/match-making/pull/95) Club owners and officials both approve bouts; clubs can withdraw their athlete (migration 52)

Run a PR's migration **before** its site deploy finishes (the deploy starts as soon as it merges), otherwise the new
pages call database functions that don't exist yet.

## 2. Run the database migrations in order

Open Supabase > SQL Editor, paste each file from [`supabase/migrations/`](supabase/migrations/) and click Run, one at a
time, in this order. Each file only runs once; "already exists" means it was run before, so skip it and carry on.
Numbers follow the list in [app/README.md](app/README.md#supabase-setup) (there is no 21).

Migrations 1 to 23 are done, and 25 was confirmed on 2 November. Everything from 24 on is listed here so nothing is
missed:

| # | File | Notes |
| --- | --- | --- |
| 24 | `20261101160000_officials_invite_officials.sql` | Redeploy `send-event-email` after |
| 25 | `20261102120000_bout_types.sql` | Confirmed done |
| 26 | `20261102140000_officials_approve_bouts.sql` | |
| 27 | `20261102200000_swap_bout_corners.sql` | |
| 28 | `20261102210000_show_public_bouts.sql` | |
| 29 | `20261102220000_officials_reorder_card.sql` | |
| 30 | `20261102230000_club_owners_see_own_people.sql` | |
| 31 | `20261102240000_club_owners_hide_other_clubs.sql` | |
| 32 | `20261103000000_invite_email_details.sql` | In PR #65; redeploy `send-event-email` after |
| 33 | `20261103010000_helper_demo_accounts.sql` | |
| 34 | `20261103020000_reject_uninvited_sign_ins.sql` | |
| 35 | `20261103030000_weigh_in_review.sql` | |
| 36 | `20261103040000_clubs_accept_invites.sql` | |
| 37 | `20261103050000_event_requests_and_approvals.sql` | |
| 38 | `20261103060000_remove_chief_official_role.sql` | |
| 39 | `20261103070000_clear_test_clubs_with_athletes.sql` | |
| 40 | `20261103080000_bc_numbers_and_official_levels.sql` | |
| 41 | `20261103110000_bout_officials.sql` | |
| 42 | `20261104010000_official_event_roles.sql` | |
| 43 | `20261104020000_min_officials.sql` | |
| 44 | `20261104030000_view_as.sql` | |
| 45 | `20261104040000_admin_and_member_accounts.sql` | |
| 46 | `20261104050000_remove_test_data.sql` | |
| 47 | `20261104060000_officials_assignment.sql` | In PR #88 |
| 48 | `20261104070000_min_officials_chief_only.sql` | |
| 49 | `20261104080000_only_chiefs_invite_officials.sql` | In PR #92 |
| 50 | `20261104090000_event_locations.sql` | In PR #93 |
| 51 | `20261104100000_hide_event_officials.sql` | In PR #94 |
| 52 | `20261104110000_clubs_approve_bouts.sql` | In PR #95 |

Files marked "In PR" only appear in the repo once that PR is merged. If a PR merges after you've run later numbers, run
its file then; don't rerun the others.

The project file `sql/check-migrations.sql` only checks up to 23, so use this table to keep track of 24 onward.

## 3. Email sending

Steps: [app/README.md, Sign-in emails](app/README.md#sign-in-emails) and [Owner emails](app/README.md#owner-emails)
(added in PR #43).

- [x] Gmail account for the app with an App password
- [x] Supabase Auth custom SMTP: `smtp.gmail.com`, port `465`, the Gmail address and App password (working since 1 November)
- [ ] Raise Authentication > Rate Limits > email to about 30 an hour
- [ ] Edge Functions > Secrets: `SMTP_USER` = the Gmail address, `SMTP_PASS` = the App password (check they match the Auth SMTP ones)
- [ ] Redeploy the `send-event-email` function from [`supabase/functions/send-event-email/index.ts`](supabase/functions/send-event-email/index.ts) after migrations 24 and 32 and after PR #65 merges
- [ ] Send yourself a test: add a user on the Users page and click the envelope, then invite an official to an event

A free Gmail account sends to about 500 people a day. When you outgrow that, move to Resend on your own domain (steps
in the Owner emails section).

## 4. Email templates

- [ ] In Authentication > Emails, paste [`supabase/templates/magic_link.html`](supabase/templates/magic_link.html) into
  **Magic Link** (subject "Your Match Making sign-in code") and
  [`supabase/templates/confirm_signup.html`](supabase/templates/confirm_signup.html) into **Confirm signup** (subject
  "Welcome to Match Making"). Repaste them after PR #65 merges, since it restyles them.
- [ ] Sign out and request a code: the email should show a 6-digit code and the Navy & Gold styling.

## 5. Google Maps (after PR #93)

Steps: the "Google Maps" section that PR #93 adds to [app/README.md](app/README.md).

- [ ] Google Cloud project with billing, **Maps JavaScript API** and **Places API (New)** turned on
- [ ] API key restricted to `https://ubaniak.github.io/*` and `http://localhost:5173/*` and to those two APIs
- [ ] GitHub > Settings > Secrets and variables > Actions > **Variables**: add `VITE_GOOGLE_MAPS_API_KEY`
- [ ] Optional: your own Map ID as `VITE_GOOGLE_MAPS_MAP_ID`
- [ ] Rerun Actions > Deploy to GitHub Pages, then check an event's location search shows a map

## 6. Clean up test data

- [ ] Delete every `@demo.test` account on the Users page (Members once PR #89 is in). They sign in with `123456`, so
  they must not stay on a live site. Migration 34 lets any `@demo.test` email sign in, so check none are left.
- [ ] Delete any test events (site Admin > the event > Delete), test clubs and test athletes.
- [ ] Check Users has only real people, with the right roles.

## 7. Final check on the live site

- [ ] Hard-refresh the site so you're on the latest deploy.
- [ ] Sign in as each role and walk the main path for it:
  - **Site Admin:** approve an event request, invite officials, use View as.
  - **Event owner:** set up the event (days, times, location), invite clubs.
  - **Club owner:** accept the invite, enter athletes, approve a bout.
  - **Official:** accept with roles and days, record a weigh-in, see the officials assignment.
- [ ] Try it on a phone too.
- [ ] Check the Auth logs and Edge Function logs in Supabase for errors.

## Optional

- [ ] **Google sign-in:** steps in [app/README.md, Google sign-in](app/README.md#google-sign-in), then add the
  `VITE_GOOGLE_SIGN_IN` = `true` variable and redeploy. It sends no email, so it eases the email limit.
