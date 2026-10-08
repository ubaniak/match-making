# Google Drive plan

The backend talks to Drive as one app identity, not as each user. Users never get direct access to the folder; their role (see [rbac.md](rbac.md)) decides what the backend will do for them. The browser never holds Drive credentials.

## Choosing the app identity

This depends on one fact still to confirm: Google Workspace or a personal Gmail account.

| Option | Use when | How it works | Watch out for |
| --- | --- | --- | --- |
| Service account + Shared Drive (recommended with Workspace) | Google Workspace | Create a service account in Google Cloud, create a Shared Drive, add the service account as a Content manager. | Needs Workspace. Files belong to the Shared Drive, so nothing breaks if a person leaves. |
| App owner account (recommended with personal Gmail) | Personal Gmail | Create a dedicated Google account for the app (for example `boxing-app@gmail.com`), sign it in once through a backend-only OAuth flow, store its refresh token as a server secret. | Set the OAuth app to "In production": refresh tokens from apps left in "Testing" expire after 7 days. |
| Service account + a normal My Drive folder | Not recommended | Share a My Drive folder with the service account's email. | Service accounts have no storage of their own, so creating new files fails with a quota error. Editing existing files works, uploads don't. |

**Scopes.** Use `drive.file` if the app creates its own folder and files: it is the narrowest scope and avoids Google's app review. Use the full `drive` scope only if the app must read files that already exist in a folder made by hand.

## Backend code

One module, `driveRepo`, wraps the `googleapis` library and is the only code that touches Drive. Route handlers call it after the permission check.

- `listFiles(folderId)`, `getFile(fileId)` for reading
- `uploadFile(folderId, name, stream)`, `updateFile(fileId, stream)` for writing
- `readRows(sheet, tab)`, `appendRow(sheet, tab, row)`, `updateRow(sheet, tab, id, row)` for Sheets

## Folder layout

```text
Boxing App/
  _admin/            Access sheet (Roles, Users, AuditLog). Backend only.
  Data               Google Sheet with tabs Boxers, Bouts, Events, Results
  Files/
    Boxers/<id>/     photos, ID documents
    Medicals/<id>/   medical certificates (medicals:read only)
```

Folder and sheet IDs are server settings, so the app doesn't depend on names.

## Storing data

Google Sheets for records, plain Drive files for documents. Sheets are easy to read and fix by hand, and the Sheets API can append and update single rows.

- **Records** (boxers, bouts, events, results): one tab per type, one row per record. Every row has an `id` (UUID), `updatedAt` and `updatedBy`. Columns never move; new fields go on the right.
- **Documents** (photos, medicals): uploaded into a per-boxer folder, with the file ID saved on the boxer's row. Medical files are only served through the backend to users with `medicals:read`.
- **Clashing edits:** the app sends the `updatedAt` it loaded with each edit. If the row has changed since, the backend rejects the save and the user reloads, so two Officials can't silently overwrite each other.
- **Formulas:** values starting with `=` are written as plain text so user input can't become a Sheet formula.
- **Limits:** the backend caches each tab briefly and writes in small batches. The Sheets API allows about 60 requests a minute per user by default, plenty for a club-sized app.

If the app outgrows Sheets, `driveRepo` can be swapped for a database without changing the RBAC system or the React app.

## Open questions

- [ ] Google Workspace or personal Gmail? This picks the identity option above.
- [ ] Is there already data in the Drive folder the app must read in its current format?
- [ ] Should anyone besides the app (for example the owner, as a backup) be able to open the folder directly?
