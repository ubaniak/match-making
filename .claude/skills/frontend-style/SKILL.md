---
name: frontend-style
description: Use when adding or changing any screen, component or style in the React app in app/. The look follows the scoreboard app (Ant Design v6), kept black on white with no dark theme.
---

# frontend-style

The match-making web app (`app/`) uses Ant Design v6 and copies the look of the scoreboard app
(github.com/ubaniak/scoreboard, `frontend/src/theme.ts`, `App.tsx`, `layouts/page.tsx`,
`components/card/card.tsx`, `components/nav/GlobalNav.tsx`). Follow this guide for every UI change.
Read `app/src/theme.js`, `app/src/ui.jsx` and `app/src/dialogs.js` before writing new UI.

## Hard rules

- **Black on white, light only.** Never use `theme.darkAlgorithm`, a dark palette, a theme toggle or
  `prefers-color-scheme: dark`. The page background is white.
- **No colour except:** black and greys for everything, `#b00000` for errors and danger buttons, and
  the boxing corners: red `#b91c1c` and blue `#1d4ed8`, used only to mark the red and blue corner
  (labels, the bar beside a boxer). No blue buttons, no green success, no coloured status tags.
- **Ant Design for every control.** Buttons, inputs, selects, pickers, tables, tags, tabs, alerts,
  modals. No raw `<button>`, `<input>`, `<select>` or `<table>` (the header's pill nav is the one exception).
- Plain JavaScript (`.jsx`), no TypeScript. Keep demo mode (`api.mode === 'mock'`) working.

## Tokens (`app/src/theme.js`)

| Token | Value |
| --- | --- |
| Font | Roboto 400/500/600/700 (Google Fonts link in `index.html`), then system sans |
| Text | `#000`; muted `rgba(0,0,0,0.65)`; faint `rgba(0,0,0,0.55)` |
| Borders | `rgba(0,0,0,0.18)`; subtle `rgba(0,0,0,0.10)`; antd `colorBorder #bfbfbf` |
| Subtle fill | `#fafafa` (table headers, forms inside a section) |
| Radius | sm 8 (inputs, selects, base), md 12 (buttons, tables, inner cards), lg 16 (cards, modals), pill 999 |
| Shadows | sm `0 2px 8px rgba(0,0,0,0.08)` (header), md `0 6px 20px rgba(0,0,0,0.12)` (cards) plus `inset 0 1px 0 rgba(255,255,255,0.7)` |
| Spacing | 4, 8, 16, 24, 32, 48. Cards are 16 apart with 16 padding |
| Headings | h1 28, h2 22, h3 18, h4 16 |
| Page width | content max 1280, centred, 12px side padding |

Primary buttons are black with the scoreboard gloss (a white top-to-clear gradient, in `index.css`).
CSS variables with the same values live at the top of `app/src/index.css`; use them in CSS instead of
new hex values.

## Layout

- **Header:** white, sticky, `min-height 64`, subtle bottom border and the small shadow. Brand on the
  left, then the pill nav (icon plus label, the active pill bold on a light grey pill), then the user's
  name, role tag and a Sign out button on the right. At 768px and below the nav wraps onto its own row.
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
- `Badge`: an outlined neutral `Tag`. `strong` is solid black (Active, Approved, In, Winner); `muted`
  is faint (Cancelled, Declined, Waiting for Admin).
- `ErrorAlert`, `SuccessAlert`, `FormMessage`: antd `Alert`s for results and errors.
- `Muted`: grey paragraph for help text. `Title`, `Text`, `Paragraph` wrap antd Typography.

## Patterns

- **Tables:** every table is `<DataTable columns dataSource rowKey>` (`app/src/DataTable.jsx`), never
  a bare antd `Table`. It adds a search box, sortable columns and pagination (10 per page, size changer
  on wider screens). Each column sorts and searches by `value(row)`, else `dataIndex`, else its `render`
  when that returns text or a number. Give a `value` to any column whose `render` returns JSX (badges,
  links) or formatted text that sorts wrongly (dates, weights): e.g. `value: (e) => e.start_date`.
  Columns with nothing to sort (action buttons, inline forms) don't sort; `sortable: false` and
  `searchable: false` opt a column out. Leave out a column with `cond && {...}` and `.filter(Boolean)`.
  Row actions go in a last column with `key: 'actions'`, `className: 'actions'` (right aligned) and no title.
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
3. No new colours, no dark styles, no raw HTML controls.
