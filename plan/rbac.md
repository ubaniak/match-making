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
- **RBAC data:** roles and users stored in an admin-only Google Sheet, edited through an Officials-only admin screen.

## Roles and permissions

Permissions are named `area:action`. The code defines the list of permissions; Officials decide which role gets which. The table is a starting default, and every cell except the Officials column can be changed later from the admin screen.

| Permission | What it allows | Officials | Coaches | Viewers |
| --- | --- | --- | --- | --- |
| `boxers:read` | See boxer profiles and records | Yes | Yes | Yes |
| `boxers:write` | Add or edit boxers | Yes | Own gym only | No |
| `bouts:read` | See proposed and confirmed bouts | Yes | Yes | Yes |
| `bouts:propose` | Suggest a match-up | Yes | Yes | No |
| `bouts:approve` | Confirm or cancel a bout | Yes | No | No |
| `events:read` | See events and cards | Yes | Yes | Yes |
| `events:write` | Create and edit events | Yes | No | No |
| `results:write` | Record bout results | Yes | No | No |
| `medicals:read` | See medical documents | Yes | Own gym only | No |
| `files:upload` | Upload documents and photos | Yes | Yes | No |
| `users:manage` | Invite users, change their role | Yes | No | No |
| `roles:manage` | Create roles, edit role permissions | Yes | No | No |
| `audit:read` | See who changed what | Yes | No | No |

- **Officials** always hold every permission. This is enforced in code, so nobody can lock themselves out by editing the Officials role.
- **Coaches** can read most areas, propose bouts and manage their own gym's boxers. "Own gym only" is a scope: the backend checks that the record's `gym` matches the coach's `gym`.
- **Viewers** are read-only and see only the areas ticked for them.
- Extra roles (for example "Judge" or "Matchmaker") can be created later by picking permissions from the same list.

## Data model

Three tabs in one Google Sheet called `Access`, inside an admin-only subfolder that only the backend can open.

| Tab | Columns | Notes |
| --- | --- | --- |
| Roles | `id`, `name`, `description`, `permissions`, `system` | `permissions` is a comma-separated list like `boxers:read,bouts:read`. `system = true` marks Officials, Coaches and Viewers so they can't be deleted. |
| Users | `email`, `name`, `roleId`, `gym`, `status`, `invitedBy`, `createdAt` | `email` is the Google account. `status` is `invited`, `active` or `disabled`. `gym` drives the "own gym only" scope. |
| AuditLog | `timestamp`, `actorEmail`, `action`, `target`, `details` | Append-only. Every role change, user change and data write adds a row. |

The permission list itself lives in code (`permissions.ts`), because each permission has to be checked somewhere in the backend. Adding a new area of the app means adding its permissions there; deciding who gets them is done through the admin screen.

One owner email is set as a server setting (`OWNER_EMAIL`). That account is always treated as an Official, which is the way back in if the Sheet is ever edited badly.

## Sign-in

1. The React app shows a "Sign in with Google" button (Google Identity Services).
2. Google returns an ID token to the browser, which posts it to `POST /api/auth/google`.
3. The backend verifies the token with `google-auth-library`: audience is the app's client ID, issuer is Google, the token hasn't expired and the email is verified.
4. The backend looks the email up in the Users tab.
    - Found and active: it sets a session cookie (`httpOnly`, `Secure`, `SameSite=Lax`, about 8 hours).
    - Not found or disabled: sign-in is refused with an "ask an Official for access" message.
5. The React app calls `GET /api/me` and gets the user's name, role and permission list.

The session cookie holds only the email. The role is looked up on each request from a short cache (about 60 seconds), so a role change takes effect within a minute without signing out.

## Enforcement

**Backend.** Every API route declares the permission it needs:

```ts
router.post('/bouts', requirePermission('bouts:propose'), createBout);
router.put('/boxers/:id', requirePermission('boxers:write', { scope: 'ownGym' }), updateBoxer);
```

`requirePermission` loads the user's role, checks the permission is in its list, and for scoped permissions checks the record's `gym` matches the user's `gym`. Officials pass every check. A failed check returns `403` and is written to the audit log.

**React.** An `AuthProvider` loads `/api/me` once and exposes the permission list.

- `<Can permission="bouts:approve">…</Can>` shows its children only when the user holds that permission. Use it for buttons and menu items.
- `<RequirePermission permission="users:manage">` wraps whole routes and shows a "no access" page otherwise.

A test suite runs every route against each default role and checks the result matches the matrix above, so a missed check is caught before it ships.

## Admin screens

| Page | What an Official can do |
| --- | --- |
| Users | Invite someone by Google email and pick their role and gym; change a role; disable or re-enable an account. |
| Roles | See a grid of every permission against every role and tick or untick boxes; create a role; delete a custom role nobody holds. |
| Activity | Browse the audit log, filtered by person, area or date. |

Safety rules: the last active Official can't be demoted or disabled, and the Officials column in the Roles grid is locked to all permissions.

## Security checklist

- [ ] Google credentials live only in the server's secret store, never in the React bundle or the repo.
- [ ] Every API route has a `requirePermission` check, covered by the role-matrix test.
- [ ] Google ID tokens are checked for audience, issuer, expiry and a verified email.
- [ ] Session cookies are `httpOnly`, `Secure` and `SameSite`, and write requests carry a CSRF token.
- [ ] Every role change and data write is logged in AuditLog.

## Build order

1. **Google setup.** Google Cloud project, OAuth client for sign-in, the Drive identity (see [google-drive.md](google-drive.md)), the folder and the `Access` sheet with the owner as first Official.
2. **Backend skeleton.** Express app, Google sign-in, session cookie, `/api/me`, `permissions.ts` and `requirePermission`. Check: sign in and see your role.
3. **Drive layer.** `driveRepo` plus the Boxers tab as the first real area. Check: list and add boxers.
4. **React shell.** Sign-in page, `AuthProvider`, `<Can>`, `<RequirePermission>`, Boxers screen. Check: as a Viewer the edit buttons are gone and edits are refused.
5. **Admin screens.** Users, Roles grid, Activity. Check: change a Coach's permissions and see their screen change within a minute.
6. **Remaining areas.** Bouts, events, results, medicals, each adding its permissions to the list.
7. **Hardening and deploy.** Role-matrix tests, audit logging, then deploy the React app and backend on one domain (for example Google Cloud Run or Render).

## Open questions

- [ ] Should Coaches edit only their own gym's boxers, or every boxer?
- [ ] Are boxers, bouts, events, results and medicals the right list of areas, or are there others?
- [ ] How do new people get in: invite-only by an Official, or sign in and wait for approval?
