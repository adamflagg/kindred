# Camperships design language

**The required style guide for every Camperships (`/aid`) surface, and the candidate common language for the rest of the app.** The owner approved it on 2026-10-09 as "one Camperships design language", together with a mock kit and one final mock per page, and every Camperships screen was rebuilt to it.

Camperships is a work app shaped like a spreadsheet, so the rules favour density, one-row toolbars, and grids that read like a sheet. Each rule below names the **kit export that implements it**. Use the export. Do not restate its classes by hand.

Paths are relative to `frontend/src/components/camperships/` unless they say otherwise. The tokens live in `kit/csType.ts`, which re-exports the grid colours from `kit/kitStyles.ts`. The tests next to each primitive pin the numbers quoted here.

**Kit comments cite "design-language §N".** That numbering comes from the original 24-rule working set. This document regroups those rules, as follows:

| Comment cites | Section here |
|---------------|--------------|
| §1 type, §2 density, §19 titles | 1 |
| §5 one row, §6 sentence rows | 2 |
| §3 picker | 3 |
| §4 CSV, §17 no white boxes | 4 |
| §7 cells, §8 rules and headers, §9 one green, §10 totals | 5 |
| §11 chips, §15 household naming | 6 |
| §12 footnotes | 7 |
| §13 truncation | 8 |
| §18 switchers | 9 |
| §23 scroll boxes | 10 |
| §24 editors | 11 |
| §21 shell | 12 |
| §10 in `Cards.tsx` (figure cards) | 13 |
| §14 sessions | 14 |
| §16 explanations, §21 staff words | 15 |

---

## How this relates to "Family Camp Models Summer"

Root `CLAUDE.md` §4 says weekend and Family Camp surfaces model summer. The two rules do not conflict. Each one names a **reference surface** for its own area:

| Area | Reference surface | Rule |
|------|-------------------|------|
| Weekend / Family Camp | Summer (the bunking board and its hooks) | `CLAUDE.md` §4 "Family Camp Models Summer" |
| Camperships (`/aid`) | This kit (`kit/`, `shell/`) | This document |
| Any other module | Its own choice, stated (see [Extending beyond Camperships](#extending-beyond-camperships)) | This document's last section |

§4's other rows still hold inside Camperships: RBAC constants, `fetchWithAuth`, query keys from `utils/queryKeys.ts`, the `queryClient` defaults, and `ErrorBoundary` + `QueryGuard`. This document governs only the **look and the words**: the type, controls, grids, chips, notes and chrome.

Where Camperships deliberately differs from summer, the reason is stated at that rule. The clearest case is the picker's fill (§3).

---

## 0. The rules on one page

| # | Rule | Kit |
|---|------|-----|
| 1 | Cells are 14px and headers 12px. Toolbar controls and their labels are 12.5px | `CS_TD`, `CS_TH`, `CS_FLABEL` |
| 2 | Every toolbar control is 26px tall. An editor field is 30px at 13.5px. Cells are padded 5px 8px | `CS_CTL_H`, `CS_FIELD`, `TD` |
| 3 | Every select is the white picker. Multi-choice is the same picker with checkboxes. A date is a real date field | `AidPicker`, `AidPickerMulti`, `CS_DATE` |
| 4 | Download CSV is the 26px button, last on its row. Copy matches it | `AidCsvButton`, `AidCopyButton` |
| 5 | Every toolbar is ONE row that never wraps | `AidToolbar`, `AidTable` toolbar slots |
| 6 | No sentence row that comes and goes | `AidFilterChip`, toolbar status, column `help` |
| 7 | Grids: card-white cells, a rule on every column, headers on one line | `TD`, `TH`, `CS_RULE`, `CS_RULE_GROUP` |
| 8 | One green band for every section row and total row | `CS_BAND`, `CS_BAND_WARN`, `TFOOT_CELL`, `ROW_TOTAL` |
| 9 | Chips are one line, 11.5px/600, in sentence case | `StatusPill`, `PILL` |
| 10 | Footnote marks are 0.72em. At most 6 notes, each with its term in bold | `DefRef`, `DefinitionNotes`, `NOTES_CAP` |
| 11 | Every truncated text carries a native `title` | `Cut`, `AidColumn.title` |
| 12 | A single-choice view filter is the segmented well. Only the Requests pipeline uses the stage strip | `AidSegmented`; `CS_STRIP` |
| 13 | A scroll box is a bounded card in the page flow, never sticky to the window | `bounded`, `scrollBox`, `CS_BOUNDED`, `useFitToViewport` |
| 14 | Editors are wide and short. Dependent choices are shown switched off, never hidden | `EditorForm`, `EditorGrid`, `EditorField`, `EditorActions` |
| 15 | Page chrome: the band is 80px, 4px to the tabs, 10px to the toolbar | `AidPageHead`, `AidPageBand`, `AidTabNav` |
| 16 | Figures sit in figure cards | `AidFoldCard`, `AidCards`, `AidMeter` |
| 17 | Session names use the ruled tiny, short and full forms | `aidSessionName`, `aidTinyName`, `aidCellShortName` |
| 18 | Staff words: "the dashboard", Title Case actions, sentence-case pills, no internal ids | `Does`, `Effects`, `sentenceCase` |
| 19 | Today's one bold element is the hero bar: a 34px segmented bar with its key row, a 16px title and a 24px figure. Only Today uses it | `AidHeroCard`, `AidHeroBar`, `AidHeroKeys`, `CS_HERO_TITLE`, `CS_HERO_FIG` |

---

## 1. Type and density

- **Text keeps the app's scale.** Cells are 14/20 (`TABLE` `text-sm`) and card tables 13/19.5 (`CS_TABLE_CARD`, `CS_TD_CARD`). Headers are 12px/600 (`CS_TH`). Card body and section titles are 13.5 (`CS_BODY`, `CS_CARD_HEADING`). Meta text is 12/16 (`CS_SMALL`, `CS_PMETA`).
- **Only three roles are smaller:** toolbar controls and their labels are 12.5/18 (`CS_FLABEL`, `ToolbarLabel`), chips 11.5/16 600, and notes 11.5/16.
- **Import a role from `kit/csType.ts`, never a raw `text-*` size.** Every link carries a size: `CS_LINK` (13.5), `CS_LINK_SM` (12) or `CS_LINK_CELL` (14). An unsized link inherits 16px and wraps its row.
- **One control height.** Every toolbar control is 26px with `box-sizing: border-box` (`CS_CTL_H`): picker, search, buttons, CSV, the segmented well and date fields. Filter chips are 22px (`CS_FCHIP`).
- **Editors** use 30px fields at 13.5px: `CS_FIELD`, `CS_PICKER_FIELD` and `CS_DATE_FIELD`.
- **One cell padding**, 5px 8px, for both table kits (`TD`, `TH` in `kitStyles.ts`; the `TD_*` / `TH_*` report cells in `reportStyles.ts`).
- **Titles are DM Sans 13.5/700.** This covers section, group and table titles (`CS_CARD_HEADING`, `AidSectionHead`). The display serif is for the band title only. On a real `h2`/`h3` use `CS_CARD_HEADING`, whose `!` modifiers beat the unlayered heading styles (#2954). Never leave a heading bare.

## 2. Toolbars: one row, no sentence rows

**Every toolbar is ONE row that never wraps** (`AidToolbar`, `kit/Toolbar.tsx`; `CS_TOOLBAR` is `flex-nowrap`). Left to right:

1. **Lead** (optional): a count line, e.g. "13 lines open · $20,783 camp aid".
2. **Filters:** pickers with `ToolbarLabel`, segmented wells, checkboxes, and removable filter chips.
3. *(the flexible gap)*
4. **Status slot:** the result of the last action. It truncates, with the full words in its title.
5. **Search.**
6. **Action buttons**, in Title Case, ending "…" when they open something.
7. **Download CSV, last.**

- **On an `AidTable`, use its slots rather than a sibling `<div>` above the table:** `toolbarLead`, `toolbarAfterGrouping`, `toolbarBeforeSearch`, `toolbarStatus`, `toolbarActions` and `csvMenu`. `toolbarEnd` is the one control allowed after Download CSV (the Ledger lines card's Close).
- **A `ReportTable` heading row** follows the same order: title and a one-line description on the left, and Find · Copy · Download CSV on the right.
- **Page-level actions with no table** go in the tab row's right slot (`AidTabNav right`).
- **If the row would wrap, shorten the words.** Use shorter chip labels, shorter picker labels, or a narrower search (`searchWidth`). Never add a second line.
- **No conditional sentence rows.** Nothing sits between the tab row (or Requests' strip) and the table except the toolbar. Each kind of sentence has a fixed home:

| Sentence | Where it goes |
|----------|---------------|
| A filter that came from a link (`?live=1`, `?household=`, …) | A removable `AidFilterChip` in the toolbar, with the old sentence as its title. A failed filter is `warn` (amber) |
| Help for a column | The column's `help` (`AidColumn.help`), shown as the header tooltip |
| Help for a chip or badge | The chip's own `title` |
| The result of an action | The toolbar status slot (`toolbarStatus`, `AidToolbar status`) |
| What a past as-of date means | The band's as-of pill title (`AidPageBand asOfTitle`) |
| A data caveat that is always true | One muted line under the table, shown only when non-zero |
| A fact repeated elsewhere on screen | Deleted |

A line that **replaces** the table (loading, failed, empty) is allowed. So is a panel that follows a click.

## 3. Pickers and dates

- **Every select is `AidPicker`** (`kit/AidPicker.tsx`), in toolbars and editors alike. It is a Headless UI `Listbox` dressed in `CS_PICKER*`: card white, a 26px button with a chevron and a light shadow, a white card popover with a 200ms fade, a ✓ on the picked option, and optional group headings (programs under their pool). `size="field"` gives the 30px editor size. **New Camperships code uses no native `<select>`.** (Six remain in the household editors, `household/CaseworkForms.tsx`, `CancelForm.tsx` and `SetCostForm.tsx`; they move to `AidPicker size="field"`, and the guard grows to cover them then.) `kitPrimitives.guard.test.ts` fails on a Headless UI `Listbox` imported outside `kit/`.
- **Multi-choice is `AidPickerMulti`.** Each option has a checkbox, and the popover stays open while staff check. The button names the picks while they fit (about 22 characters) and counts them past that ("2 groups"). The title lists every name (`multiPickerWords`, `kit/pickerWords.ts`).
- **A date is `<input type="date">`** dressed as `CS_DATE` (26px) or `CS_DATE_FIELD` (30px). Never offer a list of preset dates.
- **Why the fill differs from summer's picker:** summer's `.listbox-button-compact` is page cream. It reads as white only because it floats on a white card header. Camperships controls sit straight on the parchment page, where a cream control disappears. So `AidPicker` keeps summer's behaviour and shape and takes the card fill (`--card`, one step lighter than the page in dark mode).

## 4. Buttons and Download CSV

- **Buttons are 26px, 12.5/600, radius 8, and Title Case:** `CS_BTN` (primary) and `CS_BTN2` (secondary).
- **Download CSV is `AidCsvButton`**, the same small button on every page and always the **last control on its row**. With `menu`, it becomes a split button with a 22px caret (Requests › Needs an offer › R1: the March File).
- **Copy is `AidCopyButton`**: the same button at a fixed 80px, so "✓ Copied" doesn't move its neighbours.
- No white box around a group of controls. The tinted segmented well is the only container allowed. Requests' stage strip is the exception and is card white.

## 5. Grids

- **Cells are card white on every table** (`CELL_BG`, `TABLE_CARD`). They are opaque, so pinned columns hide what scrolls under them. Never tint one page's cells alone.
- **Every column has a light vertical rule** (`CS_RULE`, already in `TD`, `TH` and the report cells; the first column drops it). The first column of a column group gets the firmer `CS_RULE_GROUP` (`DIVIDER_BEFORE` on report columns).
- **Headers stay on one line.** Use `nowrapHeaders` on `AidTable`; report headers are `whitespace-nowrap`. A group header spanning columns is centred (`TH_GROUP`). A header that truly cannot fit wraps only when centred, never left-ragged. Shorten it first, moving words to its title or a note.
- **One green band, `CS_BAND`, for every row that heads or totals a block.** This covers grid group rows (`GROUP_ROW`, `AidTable` row tone `group`), report heading rows (`ROW_HEADING`), and every total row (`TFOOT_CELL`, `ROW_TOTAL`). The band has a top edge (`CS_BAND_EDGE`) and bold ink.
- **A block that needs staff** ("No funder yet") uses `CS_BAND_WARN` (row tone `warn`), not Tailwind yellow.
- **Positive states are forest, not emerald** (`CS_OK_BG`, `CS_OK_INK`, `PILL.ok`). Emerald is retired in Camperships.
- **Total rows are bold and in the band.** They stick inside a bounded box, and their label never spills. Use `footerSpan` to span the identity columns. Keep the label short ("16 grants · 3 not counted"), with the full sentence in `footerTitle`. A note about one figure goes in that column's own `footerNote`. Report end rows ("No ZIP on file") are muted italic (`ROW_END`).
- **The opened row stays amber** (`ROW_HIGHLIGHT`, `HIGHLIGHT_EDGE`), and the header fill stays `bg-muted`.

## 6. Chips and marks

- **A chip is `StatusPill`** (`kit/Pills.tsx`, `PILL`): 11.5/16 600, fully rounded, **always one line**. In a narrow column it truncates, and its `title` carries the full words. Chips never wrap to two lines.
- **Tones:** `muted`, `ok` (forest), `amber` (needs attention), `red` (blocks), `sky` (informational), `stone` (cancelled, reversed), `purple`, and `line` (outlined).
- **Words are short and in sentence case.** In chips, "CM" stands for CampMinder: `Committed · not in CM`, `✓ in CM · Apr 3`, `split · 2`. Sentences say CampMinder in full.
- **A mark that must never be cut sits before text that may be cut.** For example, a cancellation is `CancelMark` (a muted ⊘ before the name), never a chip at the end of the row.
- **Next-up names are `AidNameChips`, and they never truncate. They drop.** A name that would be cut is hidden, and a muted "+N" counts everyone not shown (`fitChips`). That is the opposite of a status chip, which truncates with a title. A list of names reads wrong when one is half shown.
- **A household-level request** shows ⌂ and the household label (`HouseholdLabelText`, `household/HouseholdLabel.tsx`), never "Household request".

## 7. Footnotes

- **A mark is `DefRef`:** a `<sup>` at **0.72em**, 500 weight, muted (`CS_SUP`). Its `title` carries the note's words.
- **Notes are `DefinitionNotes`** (11.5/16 muted, `CS_NOTES`), fed from the server registry through `AidDefinitionNotes` (`shell/`). Each note reads **Term:** definition, with the term in bold, in one or two lines.
- **At most 6 notes per page view** (`NOTES_CAP`, `notesOverCap` in `kit/notesCap.ts`). Merge overlapping definitions. Delete notes that restate a header, describe what is visible, or state a data rule rather than a figure. A surface's registry list lives in `bunking/financial_aid/definitions.py` `SURFACES`.
- **No trailing paragraphs after a table**, and no internal ids (D123, RPT-9) in any note, header or label.

## 8. Truncation

**Every text that can truncate carries a native `title` with the full words.** This covers names, families, funders, descriptions, sessions, total labels, the status slot and chips.

- `AidTable` titles a string cell with its own words automatically. Pass `AidColumn.title(row)` when the cell shows a short form ("FC2" titled "Family Camp 2") or rich content.
- Outside a grid cell, wrap the text in `Cut` (`kit/Cut.tsx`, `CS_CUT`).
- A native `title` is allowed under the accessibility policy (§15) and costs nothing. Set it always rather than measuring overflow.

## 9. Switchers and the stage strip

- **A single-choice view filter is `AidSegmented`** (`kit/Segmented.tsx`, `CS_SEG_*`): a 26px tinted well, primary fill on the picked choice, and each count inside its own segment ("All 16"). Labels stay short, so the toolbar keeps one row.
- **The count-bearing lens strip** (`CS_STRIP`, `CS_STRIP_LENS*`) is used **only for a pipeline navigator**: stages that run in order, a lens that narrows every count beside it, and exception badges. Requests' strip is the only one.
- **The test:** if the choices have no order and no second dimension, it is a switcher.
- **Controls never disappear between views.** If a control does not apply in one view, keep it in place rather than dropping it.
- **Jump chips are neither.** Chips that jump within a page (Rules' chapters) are not filters, so neither rule applies.

## 10. Scroll boxes

- **A scroll box is a bounded card in the page's flow** (`AidTable bounded`, `ReportTable bounded`, `CS_BOUNDED`: 420px at most). It is never `position: fixed`, never sticky to the window, and never sized to fill the window exactly.
- **A viewport-sized box** (`AidTable scrollBox`, `useFitToViewport`) stops 40px short of the window's bottom edge and is never under 420px. That way the first footnote peeks above the fold.
- Inside a box, the header sticks to the box's top and the total row to its bottom. **Nothing sticks to the window.** Notes and later tables render below the box, and the page scrolls to them.
- Leave scroll chaining on. Never add `overscroll-behavior: contain`.

## 11. Editors

**Use `EditorForm` / `EditorGrid` / `EditorField` / `EditorActions`** (`kit/EditorLayout.tsx`, tokens `CS_EDITOR`, `CS_FORM2`, `CS_FGRID`, `CS_EDROW`) for every create or edit popout, panel and dialog.

- **Wide and short.** An editor with more than three fields lays them out in a two-column grid: label · field · label · field.
- **Dependent choices go in the right column**, beside what they depend on (3 : 2, with a dashed rule between).
- **A dependent choice is shown switched off, never hidden**, while its parent is unchecked (`EditorField off`). The editor never changes height.
- **Buttons sit on one row, in Title Case** ("Save Funder", "Back"). The required-field reason or the logged-with-who line sits on that same row (`EditorActions`). Any other sentence goes in the footer row, not a row of its own.
- An editor opened from a row takes the whole opened row.

## 12. Page chrome

- **The head is `AidPageHead`** (`shell/AidPageHead.tsx`). It holds the band (`AidPageBand`), then 4px, then the tab row (`AidTabNav`). The page root spaces what follows at 10px (`space-y-2.5`). Requests has no tab row: its stage strip sits 12px under the band.
- **The band is 80px tall:** a forest-700 → 800 gradient, padding 16px 24px, a 38px icon tile, and a Fraunces 20/28 title with a 14/20 subtitle ending "as of {date} (live)". A past date shows the amber as-of pill, whose title says what the date means.
- **Tabs** are `AidTabNav`, at 14/600. The active tab is primary, counts are at 400, and page-level actions go in the right slot.
- The faint background grid behind every page (`index.css`, `body::before`) is intentional. Keep it.

## 13. Figure cards

**Figures sit in kit cards** (`kit/Cards.tsx`):

- `AidFoldCard` has ONE header row: a caret and a 13.5/700 title that folds the card, a muted one-line meta, pills, and the figures on the right (a muted label with its footnote mark, then a tabular value). Opened, it shows a kit table flush under a rule. A card that opens nothing has no caret.
- `shape`: the default (full width), `compact` (figures stacked label over value; lay several across with `AidCards`), and `row` (one line, figures in fixed columns). `band` puts a total card in the green band.
- `AidMeter` (committed against allocated, amber stripes past 100%), `AidShareBar`, `AidLegend` and Today's `AidHeroBar` are the only bars. `AidHeroBar` is Today's alone: one per page, with segments that are links into the slice they count, an optional dashed budget marker, and a one-time reveal that `prefers-reduced-motion` turns off. Its `compact` form (10px, no labels) draws the pool rows under it.

## 14. Sessions and programs

**The session vocabulary has three forms and is owned by `utils/sessionName.ts`** (#2790 governs any change to it):

| Form | Example | Use |
|------|---------|-----|
| Tiny | FC1, S2, AG 2, WW | Requests' Session column (`aidTinyName`) |
| Short | Session 2, AG 2 (7-8), Family Camp 2 (no subtitle) | Other one-line cells (`aidSessionName`: tiny for Family Camp, short for the rest) |
| Full | As that year's `camp_sessions` record stores it | Every cell's title, and household headings |

- **Statistics › Session rows** show the full name when it fits on one line, and the short form otherwise (`aidCellShortName`, `reports/SessionNameCell.tsx`).
- **Counselor and Specialist In-Training show as one "SCIT"** in Camperships only (`SCIT`, `kit/sessionShort.ts`). The app-wide vocabulary is untouched.
- **A Family Camp short form never carries a subtitle**, because themes move between numbers year to year.
- **Several sessions listed together use one order:** `orderSessions` (`utils/sessionOrder.ts`, mirrored by `bunking/session_order.py`). This applies to tables, pickers, CSVs and the Rules card, on whatever subset the page shows.
- **Program words** are the shared family words: At Camp, Quests, Teen Programs, TBM, Family Camp and Adult Weekends, grouped under their pool (`requests/programLabel.ts`, `hooks/camperships/useAidProgramNames.ts`). Never write a program's name by hand.

## 15. Words, explanations and accessibility

- **Staff words:**
  - "the dashboard", never "Kindred";
  - "check" and "Mark Posted", never "tick";
  - Title Case for action buttons, ending "…" when they open something;
  - sentence case for pills and sentences (`sentenceCase`, `kit/words.ts`);
  - CM in chips, CampMinder in sentences;
  - **no internal ids** (D123, RPT-9, O-930-1) in any staff-facing text.
- **Explanations** use `Does` (a callout on its own line: a bold lead, → and the result) and `Effects` (one effect per line). Both live in `kit/Effects.tsx`.
  - Use the symbols ✓ done, ○ left for staff to check by hand, ⚠ needs a look, and → what to do next. Use · as the separator in labels.
  - Never chain clauses with colons.
- **Money** renders through `Money`, `MoneyCompact` and `ReversedAmount` (`kit/MoneyText.tsx`). Never format a figure by hand.
- **Accessibility is opt-out here.** Follow `frontend/CLAUDE.md` § "Accessibility — deliberately minimal": add `aria-label` / `role` only as a test query handle, and add no `sr-only`, `aria-live` or extra keyboard handlers. Native `title` tooltips are the one affordance this guide requires everywhere (§8).

---

## Adding to the kit

1. **A pattern the kit lacks goes into `kit/` first, with its tests.** Then it gets a rule here naming the export. A page never grows a private near-copy of a picker, toolbar, table, CSV button or chip.
2. **Tokens live in `kit/csType.ts`.** Exports marked `@deprecated` (`CS_SELECT`, `CS_SELECT_CTL`, `CS_INPUT`, `CS_BTN_TOOL`, `PILL.emerald`) exist only so older call sites keep rendering correctly. New code never uses them.
3. **Visual changes hold for the owner.** Every Camperships screen has an approved mock. A change matches that mock and this guide before it is called merge-ready, and anything with visual impact waits for the owner's eyes before merge.
4. **Change a rule here, not in one place.** If a rule turns out wrong, change it in this document and the kit together. Never work around it on a single page.

## Extending beyond Camperships

This kit is the first module-level design language in the app. The owner sees three futures for the other areas (Summer, Family Camp / weekend, Metrics, admin), and each may take a different one:

1. **Keep diverging.** The area keeps its own look. Summer stays the reference for weekend (`CLAUDE.md` §4).
2. **Get a per-module kit.** The area grows its own `kit/` and its own design-language document, built the same way: rules mapped to exports, tests that pin the numbers, and an owner-approved mock.
3. **Adopt this kit.** The area imports these primitives directly.

**The rule:**

- **A new or reworked surface outside Camperships must say which of the three it is choosing**, in its PR body and, for option 2, in its kit's document.
- **A surface that adopts reuses the kit primitives** (`AidPicker`, `AidToolbar`, `AidCsvButton`, `AidTable`, `StatusPill` and the rest), not near-copies. If a primitive needs a new prop to fit, add the prop to the kit, with a test. If adoption reaches far enough, the primitives move to a shared home, and this document moves with them.
- **Never mix the options on one surface.** A page that half-adopts this kit beside its own module's controls is the inconsistency this guide exists to end.

Candidates already identified for a cross-app pass:

- Summer, Metrics and the scenario comparison each draw a different CSV button. `AidCsvButton` could become the app's one.
- Native `<select>`s outside Camperships could move to `AidPicker`, starting with the solver debug pages, which have no dark-mode styling.
