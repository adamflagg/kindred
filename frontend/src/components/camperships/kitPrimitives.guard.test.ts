/**
 * The Camperships design language (docs/reference/camperships-design-language.md §3): every select is the
 * kit's AidPicker. A Headless UI Listbox anywhere in Camperships outside kit/ is a one-off picker, a
 * near-copy of AidPicker that drifts from it, so this fails on one. Source-level, like the other *.guard
 * tests: what matters is the import, not a render.
 *
 * Not guarded here (yet): native <select>. The household editors still draw six of them
 * (household/CaseworkForms.tsx, CancelForm.tsx, SetCostForm.tsx); add that guard once they move to
 * AidPicker size="field".
 */
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob<string>(
  [
    './**/*.{ts,tsx}',
    '../../pages/camperships/**/*.{ts,tsx}',
    '!./**/*.test.{ts,tsx}',
    '!../../pages/camperships/**/*.test.{ts,tsx}',
  ],
  { query: '?raw', import: 'default', eager: true }
)

/** An import of Listbox (or ListboxButton, ListboxOptions, …) from Headless UI. */
const LISTBOX_IMPORT =
  /import\s*(?:type\s*)?\{[^}]*\bListbox\w*\b[^}]*\}\s*from\s*['"]@headlessui\/react['"]/

const isKit = (path: string) => path.startsWith('./kit/')

describe('Camperships pickers come from the kit', () => {
  it('reads the Camperships sources (the glob is not empty)', () => {
    expect(Object.keys(SOURCES).some((path) => path === './kit/AidPicker.tsx')).toBe(true)
    expect(Object.keys(SOURCES).filter((path) => !isKit(path)).length).toBeGreaterThan(20)
  })

  it('imports no Headless UI Listbox outside kit/ (use AidPicker / AidPickerMulti)', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path, source]) => !isKit(path) && LISTBOX_IMPORT.test(source))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
