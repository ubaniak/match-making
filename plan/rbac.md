# RBAC plan

Users sign in with Google. A small backend looks up their role and checks permissions on every request before it touches Google Drive (see [google-drive.md](google-drive.md)). The React app only hides what a user can't use; the backend is the only place permissions are enforced.

## Architecture

```text
React app  --/api-->  Backend API  --Drive API-->  Drive folder
    |                     |                         _admin/Access sheet
    |  ID token           |  verifies token         Data sheet
    v                     v                         Files/
         Google sign-in
```

- **Front end:** React (Vite). Shows or hides screens based on the signed-in user's permissions.
- **Backend:** Node + Express (TypeScript). Holds the Google credentials and enforces RBAC.
- **Auth:** Google sign-in. The backend verifies the Google token and issues its own session cookie.
- **RBAC data:** roles and users stored in an admin-only Google Sheet, edited through an Admins-only screen.

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

Permissions are named `area:action`. The code defines the list; Admins decide which role gets which from the admin screen. The table is the starting default. Some permissions are scoped, and the backend checks the scope against the record:

- **Self:** the record is the signed-in user's own (their athlete or official profile).
- **Own:** the user created or is responsible for the record (a coach's cards and athletes).

| Permission | What it allows | Admins | Officials | Coaches | Athletes | Public |
| --- | --- | --- | --- | --- | --- | --- |
| `public:read` | View public pages | Yes | Yes | Yes | Yes | Yes |
| `pages:read` | View member pages | Yes | Yes | Yes | Yes | No |
| `cards:read` | View cards and their bouts | Yes | Yes | Yes | Yes | Public cards only |
| `cards:create` | Create a card (creator becomes owner) | Yes | No | Yes | No | No |
| `cards:manage` | Edit a card, accept or decline submissions, set bouts | Yes | No | Own | No | No |
| `cards:submit-official` | Put an official's name forward for a card | Yes | Self | No | No | No |
| `cards:submit-athlete` | Put an athlete's name forward for a card | Yes | No | Own athletes | No | No |
| `athletes:read` | View athlete profiles | Yes | Yes | Yes | Yes | No |
| `athletes:create` | Add an athlete | Yes | No | Yes | No | No |
| `athletes:write` | Edit an athlete's profile | Yes | No | Own | Self | No |
| `officials:read` | View official profiles | Yes | Yes | Yes | No | No |
| `officials:write` | Edit an official's profile | Yes | Self | No | No | No |
| `files:upload` | Upload documents and photos to a profile | Yes | Self | Own athletes | Self | No |
| `users:manage` | Invite users, change their role, remove access | Yes | No | No | No | No |
| `roles:manage` | Create roles, edit role permissions | Yes | No | No | No | No |
| `audit:read` | See who changed what | Yes | No | No | No | No |

- **Admins** always hold every permission. This is enforced in code, so nobody can lock themselves out by editing the Admins role.
- **Public** covers people who aren't signed in, and signed-in Google accounts that haven't been given a role yet.
- Extra roles can be created later by picking permissions from the same list.

## Data model

Three tabs in one Google Sheet called `Access`, inside an admin-only subfolder that only the backend can open.

| Tab | Columns | Notes |
| --- | --- | --- |
| Roles | `id`, `name`, `description`, `permissions`, `system` | `permissions` is a comma-separated list like `cards:read,athletes:read`. `system = true` marks the five built-in roles so they can't be deleted. |
| Users | `email`, `name`, `roleId`, `status`, `invitedBy`, `createdAt` | `email` is the Google account. `status` is `invited`, `active` or `disabled`. |
| AuditLog | `timestamp`, `actorEmail`, `action`, `target`, `details` | Append-only. Every role change, user change and data write adds a row. |

Scopes are checked against ownership columns on the app's own records (see [google-drive.md](google-drive.md)):

- An athlete row has `userEmail` (the athlete's own login, if they have one) and `coachEmail` (the coach who added them).
- An official row has `userEmail`.
- A card row has `ownerEmail`.
- A card submission row has `submittedBy`, and its `status` (`pending`, `accepted`, `declined`) is set by the card's owner.

The permission list lives in code (`permissions.ts`), because each permission has to be checked somewhere in the backend. Adding a new area of the app means adding its permissions there; deciding who gets them is done through the admin screen.

One owner email is set as a server setting (`OWNER_EMAIL`). That account is always treated as an Admin, which is the way back in if the Sheet is ever edited badly.

## Sign-in

1. The React app shows a "Sign in with Google" button (Google Identity Services). Public pages work without signing in.
2. Google returns an ID token to the browser, which posts it to `POST /api/auth/google`.
3. The backend verifies the token with `google-auth-library`: audience is the app's client ID, issuer is Google, the token hasn't expired and the email is verified.
4. The backend looks the email up in the Users tab.
    - Found and active: it sets a session cookie (`httpOnly`, `Secure`, `SameSite=Lax`, about 8 hours).
    - Not found: the user is treated as Public and shown an "ask an Admin for access" message.
    - Disabled: sign-in is refused.
5. The React app calls `GET /api/me` and gets the user's name, role and permission list.

The session cookie holds only the email. The role is looked up on each request from a short cache (about 60 seconds), so a role change takes effect within a minute without signing out.

## Enforcement

**Backend.** Every API route declares the permission it needs:

```ts
router.get('/public/cards', requirePermission('public:read'), listPublicCards);
router.post('/cards/:id/submissions', requirePermission('cards:submit-athlete', { scope: 'ownAthlete' }), submitAthlete);
router.put('/athletes/:id', requirePermission('athletes:write', { scope: ['own', 'self'] }), updateAthlete);
```

`requirePermission` loads the user's role, checks the permission is in its list, and for scoped permissions checks the record's ownership columns against the user's email. Admins pass every check. A failed check returns `403` and is written to the audit log.

**React.** An `AuthProvider` loads `/api/me` once and exposes the permission list.

- `<Can permission="cards:manage">…</Can>` shows its children only when the user holds that permission. Use it for buttons and menu items.
- `<RequirePermission permission="users:manage">` wraps whole routes and shows a "no access" page otherwise.

A test suite runs every route against each default role and checks the result matches the matrix above, so a missed check is caught before it ships.

## Admin screens

| Page | What an Admin can do |
| --- | --- |
| Users | Invite someone by Google email and pick their role; change a role; disable or re-enable an account. |
| Roles | See a grid of every permission against every role and tick or untick boxes; create a role; delete a custom role nobody holds. |
| Activity | Browse the audit log, filtered by person, area or date. |

Safety rules: the last active Admin can't be demoted or disabled, and the Admins column in the Roles grid is locked to all permissions.

## Security checklist

- [ ] Google credentials live only in the server's secret store, never in the React bundle or the repo.
- [ ] Every API route has a `requirePermission` check, covered by the role-matrix test.
- [ ] Public routes return only fields marked public (no contact details or documents).
- [ ] Google ID tokens are checked for audience, issuer, expiry and a verified email.
- [ ] Session cookies are `httpOnly`, `Secure` and `SameSite`, and write requests carry a CSRF token.
- [ ] Every role change and data write is logged in AuditLog.

## Build order

1. **Google setup.** Google Cloud project, OAuth client for sign-in, the Drive identity (see [google-drive.md](google-drive.md)), the folder and the `Access` sheet with the owner as first Admin.
2. **Backend skeleton.** Express app, Google sign-in, session cookie, `/api/me`, `permissions.ts` and `requirePermission`. Check: sign in and see your role.
3. **Drive layer.** `driveRepo` plus the Athletes tab as the first real area. Check: a coach adds an athlete; the athlete signs in and edits only their own profile.
4. **React shell.** Sign-in page, `AuthProvider`, `<Can>`, `<RequirePermission>`, Athletes screen. Check: as Public the edit buttons are gone and edits are refused.
5. **Admin screens.** Users, Roles grid, Activity. Check: change a role's permissions and see that user's screen change within a minute.
6. **Cards.** Card creation, official and athlete submissions, owner accepts or declines.
7. **Hardening and deploy.** Role-matrix tests, audit logging, then deploy the React app and backend on one domain (for example Google Cloud Run or Render).

## Open questions

- [ ] What should Public see: only upcoming public cards and results, or also athlete profiles? The default above is public cards only.
- [ ] Who accepts an official's or athlete's submission to a card: only the card's owning coach, or Admins too? The default is the owner, with Admins able to override.
- [ ] Can a coach edit athletes added by another coach, or only their own? The default is only their own.
- [ ] How does an athlete get linked to their profile: the coach enters the athlete's Google email when adding them, or the athlete claims the profile and the coach approves? The default is the coach enters it.
- [ ] Can Officials see athlete profiles, and can Athletes see official profiles? The default is Officials yes, Athletes no.
- [ ] How do new people get in: invite-only by an Admin, or sign in and wait for approval?
