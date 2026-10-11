# frontend/src/components/camperships/

Camperships (`/aid`) has a **required design language**: `docs/reference/camperships-design-language.md`. Read it before you add or change any Camperships UI. It maps each rule to the kit export that implements it. The kit is `kit/` (primitives and tokens; `kit/csType.ts` is the one type scale) and `shell/` (band, tabs, page head and notes).

## Rules

- **MUST use the kit primitives.** Use `AidPicker` / `AidPickerMulti` for every select, and `CS_DATE` for dates. Use `AidToolbar` or `AidTable`'s toolbar slots for toolbars. Use `AidTable` / `ReportTable` for tables, `AidCsvButton` / `AidCopyButton` for downloads, `StatusPill` for chips, `AidSegmented` for either/or filters, and `EditorForm` and its parts for editors. Notes go through `DefinitionNotes` (6 at most), and truncated text through `Cut` (always titled).
- **No one-off pickers, toolbars, tables, CSV buttons or chips.** That includes a native `<select>`, a hand-rolled Listbox, a toolbar `<div>` above a table, or a pill class composed by hand. `kitPrimitives.guard.test.ts` fails the build on a native `<select>` anywhere in Camperships and on a Headless UI `Listbox` outside `kit/`. A picker of household or camper names takes `fill`; other pickers stay compact unless the mock draws their box (Cancel reason's 330px).
- **Editors: white on not white, green on white.** `EditorForm` is the white card on the page, an opened row's cream or a popover. Inside a white card or table (every household editor, the household's grant editors, To place's Reopen…) pass `onWhite` for the band tint. It is one card: never a second editor style or a hand-copied class string. Season › Rules' grouped single-column editor is the one documented layout exception.
- **Take sizes and colours from `kit/csType.ts`**, never a raw `text-*` size or a Tailwind colour where a token exists. Do not use exports marked `@deprecated`.
- **A new pattern goes into `kit/` first, with tests**, and gets a rule in the design-language doc naming the export. Only then does a page use it.
- **Match the approved mock and the design rules before calling a PR MERGE READY.** Anything with visual impact still holds for the owner's eyes before merge.
- **Words:** "the dashboard", Title Case action buttons, sentence-case pills, CM in chips and CampMinder in sentences, and no internal ids (D123, RPT-9) in staff text. Session names come from `kit/sessionShort.ts`, never a raw `session_name`.
- **Accessibility stays opt-out** (`frontend/CLAUDE.md`). A native `title` on truncated text is required. ARIA attributes are added only as test handles.

## How it relates to the rest of the app

This kit is the reference for Camperships, as summer is the reference for weekend (root `CLAUDE.md` §4 "Family Camp Models Summer"). It is also the candidate common language for other modules. A surface outside `/aid` that adopts it imports these primitives rather than copying them. The doc's "Extending beyond Camperships" section sets that rule.
