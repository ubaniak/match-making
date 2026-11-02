---
name: frontend-style
description: Use when adding or changing any screen, component or style in the React app in app/. Ant Design v6 in the Navy & Gold scheme on light pages, sized for an older audience, never dark.
---

# frontend-style

The match-making web app (`app/`) uses Ant Design v6 in the **Navy & Gold** scheme Bhavek picked on
2026-11-02 (modern, glossy, accessible for an older audience). The layout copies the scoreboard app
(github.com/ubaniak/scoreboard, `frontend/src/theme.ts`, `App.tsx`, `layouts/page.tsx`,
`components/card/card.tsx`, `components/nav/GlobalNav.tsx`). Follow this guide for every UI change.
Read `app/src/theme.js`, `app/src/ui.jsx` and `app/src/dialogs.js` before writing new UI.

## Hard rules

- **Light pages only.** Never use `theme.darkAlgorithm`, a dark palette, a theme toggle or
  `prefers-color-scheme: dark`. The page is a light navy tint (`#f3f5fa`), cards are white. The navy
  header bar is the only dark band.
- **Colours come from the scheme.** Navy `#1e3a8a` for primary buttons, links, active tabs and strong
  tags; gold `#f5b800` for the header stripe, the active nav pill and primary buttons on the header;
  soft gold `#fde68a` for table headers; `#b00000` for errors and danger buttons; the boxing corners
  red `#b91c1c` and blue `#1d4ed8` only to mark the red and blue corner. Never add a new hex value: use
  the tokens in `theme.js` or the CSS variables in `index.css`.
- **Accessible for older users.** Body text 17px (16px on phones, never below 14px anywhere), buttons,
  inputs and nav pills at least 44px tall, text `#111`/`#333` (no faint greys, placeholders `#6b7280`),
  focus outlines 3px. Any text and background pair must reach WCAG AA (4.5:1); aim for AAA (7:1).
- **Ant Design for every control.** Buttons, inputs, selects, pickers, tables, tags, tabs, alerts,
  modals. No raw `<button>`, `<input>`, `<select>` or `<table>` (the header's pill nav is the one exception).
- Plain JavaScript (`.jsx`), no TypeScript. Keep demo mode (`api.mode === 'mock'`) working.

## Tokens (`app/src/theme.js`)

| Token | Value |
| --- | --- |
| Font | Roboto 400/500/600/700 (Google Fonts link in `index.html`), then system sans. Base 17px, LG 18, SM 15 |
| Navy | `#1e3a8a` primary (10.4:1 on white); hover `#1d4ed8`; deep `#14245a` (page titles, text on gold); gloss top `#3b5bcc` |
| Gold | `#f5b800` (stripe, active pill, header buttons); soft `#fde68a` (table headers) |
| Page | `#f3f5fa`; cards and modals `#fff`; subtle fill `#eef1f8` (forms inside a section) |
| Text | `#111`; muted `#333`; faint `#4a4a4a`; on navy `rgba(255,255,255,0.92)`; placeholder `#6b7280` |
| Borders | antd `colorBorder #9aa1ab`; subtle `#dde1e7` |
| Status | error `#b00000`, success `#15803d`, warning `#b45309` |
| Controls | height 44 (SM 34, LG 52), focus line 3 |
| Radius | sm 10 (inputs, selects, base), md 12 (buttons, tables, inner cards), lg 18 (cards, modals), pill 999 |
| Shadows | sm `0 4px 16px rgba(30,58,138,0.18)` (header), md `0 8px 24px rgba(30,58,138,0.10), 0 2px 6px rgba(0,0,0,0.06)` (cards) plus `inset 0 1px 0 rgba(255,255,255,0.9)` |
| Spacing | 4, 8, 16, 24, 32, 48. Cards are 16 apart with 16 padding |
| Headings | h1 32, h2 26, h3 21, h4 18. Page titles are navy deep |
| Page width | content max 1280, centred, 12px side padding |

Primary buttons are glossy navy (a `#3b5bcc` to `#1e3a8a` to `#182f73` gradient with a white inner
highlight and a soft navy glow, in `index.css`); on the navy header they are glossy gold with navy text.
Danger buttons stay red. Card headers have a faint white-to-page-tint gloss.
CSS variables with the same values live at the top of `app/src/index.css`; use them in CSS instead of
new hex values.

## Layout

- **Header:** glossy navy gradient bar with a 4px gold bottom stripe, sticky, `min-height 64`, white
  22px brand on the left, then the pill nav (16px icon plus label in near-white, 44px tall; the active
  pill bold navy text on a glossy gold pill), then the user's name, role tag and a white Sign out button
  on the right. At 768px and below the nav moves onto its own row and its pills wrap, so none is cut off.
- **Demo banner:** a full-width antd `Alert` above the header.
- **Page:** `<main className="panel">`, then `<PageHeading title subtitle>` with the page's buttons as
  children (primary action last, on the right). Detail pages put a `<BackLink>` above the heading.
- **Sections:** each block of a page is a `<Section title extra>`: a rounded card with the shadow, its
  title and any buttons in the card header (scoreboard's `TableLayout`).
- **Signed-out screens:** one centred card, max 400 wide, large inputs, full-width primary button.

## Components (`app/src/ui.jsx`)

- `FormCard`: a form in a card. Fields go side by side and wrap (`Field`, 200px minimum each);
  `FullRow` for a note or error across the row; buttons go in `actions`. Inside a `Section` it turns into
  a flat grey box so shadows never stack. Without `onSubmit` it renders no `<form>`, so several can sit
  in one bigger form. Use `compact` for one or two short fields.
- `Field label hint`: an antd vertical form label; `hint` shows as grey "(optional)" text.
- `Pick`: antd `Select` that uses `''` for "nothing chosen". Use `placeholder` for "Choose…"; pass
  `allowEmpty` with a `{ value: '', label: 'No coach' }` option when "none" is a real choice.
- `DateInput`, `TimeInput`, `DateTimeInput`, `NumberInput`: antd pickers that take and return the same
  strings the API uses (`YYYY-MM-DD`, `HH:mm`, `YYYY-MM-DDTHH:mm`, `''` for empty).
- `Badge`: an outlined navy `Tag` (14px). `strong` is solid navy (Active, Approved, In, Winner); `muted`
  is grey (Cancelled, Declined, Waiting for Admin).
- `ErrorAlert`, `SuccessAlert`, `FormMessage`: antd `Alert`s for results and errors.
- `Muted`: grey paragraph for help text. `Title`, `Text`, `Paragraph` wrap antd Typography.

## Patterns

- **Full CRUD, always (Bhavek's rule).** Every kind of record the app manages, users included,
  gets the whole set: **create**, **read** (a searchable `DataTable` list, plus details where a row
  has more to show), **update** (edit every field that can change) and **delete**. Never ship an
  add-only screen. Delete sits behind `askConfirm(..., { danger: true })`, and when the database
  refuses (a record still in use), show its message and say what to do first (for example "Withdraw
  the athlete first"). The edit and delete buttons follow the row-action pattern below. A new table
  or record type isn't done until its migration, both API files (`supabaseApi.js` and
  `mockApi.js`) and the UI cover all four.
- **Tables:** every table is `<DataTable columns dataSource rowKey>` (`app/src/DataTable.jsx`), never
  a bare antd `Table`. It adds a search box, sortable columns and pagination (10 per page, size changer
  on wider screens). Each column sorts and searches by `value(row)`, else `dataIndex`, else its `render`
  when that returns text or a number. Give a `value` to any column whose `render` returns JSX (badges,
  links) or formatted text that sorts wrongly (dates, weights): e.g. `value: (e) => e.start_date`.
  Columns with nothing to sort (action buttons, inline forms) don't sort; `sortable: false` and
  `searchable: false` opt a column out. Leave out a column with `cond && {...}` and `.filter(Boolean)`.
  Row actions go in a last column with `key: 'actions'`, `className: 'actions'` (right aligned) and no title.
- **CSV download:** every `DataTable` has a "Download CSV" button beside its search box. It saves
  every row that matches the search (not just the current page) in the shown sort order, named
  `<csvName> <date>.csv`, so pass a `csvName` (e.g. `` csvName={`${event.name} athletes`} ``). A
  column's CSV text is `csv(row)`, else its `render` when that returns text, else its sort value;
  action columns drop out, `csv: false` drops any other. Lists that aren't tables (the bout card,
  the public approved bouts) use `DownloadCsvButton` from `DataTable.jsx` with their own rows.
- **CSV upload:** every place that adds records also offers `<CsvImport kind=... />` (`CsvImport.jsx`)
  under its add form, shown to the same people. It gives a template download, a preview with each
  row's problems, then adds the good rows one by one through the same `api` call as the form (so
  the database's role rules still apply). Describe the columns and per-row checks in `importSpecs`
  (`imports.js`); look people, clubs and athletes up by email or name and say plainly why a row
  can't be added. `importRow` can return `{ note }` for something to check (e.g. an email that
  didn't go out).
- **Row actions:** edit and delete are small circle icon buttons (`EditOutlined`, `DeleteOutlined`)
  with an `aria-label`, delete wrapped in a `Popconfirm`. Decisions (Approve, Accept, Decline) are
  small buttons, the positive one primary. Inline links (`type="link"`) for lighter actions.
- **Questions:** never `window.confirm`, `window.prompt` or `window.alert`. Use `await askConfirm(text,
  { okText, danger })`, `await askText(text, { okText })` (returns `null` on Cancel) and `showError(text)`
  from `dialogs.js`.
- **Buttons:** one primary button per form or heading. `danger` for destructive actions. Show progress
  with `loading` and the existing "Saving…" text.
- **Day or mode switches:** antd `Tabs` (as scoreboard's `RoutedTabs`); `Segmented` for a small set
  of modes inside a card.
- **Optional panels:** antd `Collapse` (CSV import, cancelled bouts).
- **Uploads:** antd `Upload` with `showUploadList={false}` and `beforeUpload={(file) => { handle(file); return false }}`.
- **Bouts:** one small card per bout; red corner on the left with a red bar, blue on the right with a
  blue bar, "vs" between. On phones the corners stack.

## Phones

The app must work on a 390px-wide phone.

- Below 768px (antd `md`) `DataTable` hides the header row and shows each row as a small bordered card,
  each value labelled with its column title (so give columns plain-string titles). Sorting moves to a
  "Sort by" select above the table.
- The header wraps to two rows (brand and Sign out, then the pill nav) and stops being sticky; the
  user's name is hidden.
- Form fields stack one per row, card headers wrap their buttons under the title, bout corners stack.
- Check there is no sideways page scroll: `document.documentElement.scrollWidth` equals the width.

## Accessibility

- Every icon-only button has an `aria-label`. Focus rings stay visible.
- Inputs are at least 16px on phones (stops iOS zoom; in `index.css`).
- No horizontal page scroll at 390px wide; tables scroll inside themselves.
- Respect `prefers-reduced-motion`.

## Checklist before you finish

1. `cd app && npm run lint && npm run build` pass.
2. Run `npx vite`, sign in to demo mode (`admin@matchmaking.test` / `letmein`) and look at the screen
   you changed at 1280px and 390px wide. No console errors or antd deprecation warnings.
3. No new hex values outside the scheme, no dark styles, no raw HTML controls, no text below 14px,
   no tap target under 44px.
4. Every record type you added or touched can be created, listed, edited and deleted in the UI.
