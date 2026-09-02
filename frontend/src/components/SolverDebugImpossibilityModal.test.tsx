import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SolverDebugImpossibilityModal from './SolverDebugImpossibilityModal'
import type { ImpossibilityReport } from '../services/solver'

const FILTER_STORAGE_KEY = 'solver-debug.impossibility-modal-filter'

// The global test setup replaces localStorage with vi.fn() mocks that return
// undefined. These tests need real get/set/clear semantics, so we stub in a
// minimal in-memory implementation for this suite only.
function makeRealLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      Reflect.deleteProperty(store, key)
    },
    clear: () => {
      Object.keys(store).forEach((k) => Reflect.deleteProperty(store, k))
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length
    },
  }
}

// Six-row report covering all three buckets + a multi-reason request.
// Olivia↔Riley appears twice (two reason codes, same request_id) — the
// explicit Option-B trade-off.
//
// total_impossible / affected_campers / by_bucket_count all count UNIQUE
// request_ids per backend contract (impossibility.py:_finalize_report), so
// the multi-reason r2 row collapses in the counts but stays as two table rows.
function makeReport(): ImpossibilityReport {
  const flat: ImpossibilityReport['flat'] = [
    {
      request_id: 'r1',
      reason_code: 'cross_session',
      reason_message: '',
      request_type: 'bunk_with',
      requester: { cm_id: 1000123, name: 'Emma Johnson', grade: 8, gender: 'F' },
      requestee: { cm_id: 1000456, name: 'Liam Garcia', grade: 9, gender: 'M' },
      detail: { req_sess: 12, target_sess: 13 },
      bucket: 'material_parent',
    },
    {
      request_id: 'r2',
      reason_code: 'grade_compatibility',
      reason_message: '',
      request_type: 'bunk_with',
      requester: { cm_id: 1000789, name: 'Olivia Chen', grade: 7, gender: 'F' },
      requestee: { cm_id: 1000234, name: 'Riley Sam', grade: 7, gender: 'F' },
      detail: { grade_a: 7, grade_b: 7, span: 0 },
      bucket: 'material_parent',
    },
    {
      request_id: 'r2',
      reason_code: 'pair_no_shared_bunk',
      reason_message: '',
      request_type: 'bunk_with',
      requester: { cm_id: 1000789, name: 'Olivia Chen', grade: 7, gender: 'F' },
      requestee: { cm_id: 1000234, name: 'Riley Sam', grade: 7, gender: 'F' },
      detail: { shared_bunks: 0 },
      bucket: 'material_parent',
    },
    {
      request_id: 'r3',
      reason_code: 'age_pref_no_eligible_grade',
      reason_message: '',
      request_type: 'age_preference',
      requester: { cm_id: 1000567, name: 'Samuel Johnson', grade: 10, gender: 'M' },
      requestee: null,
      detail: { prefers: 'younger', grade: 10 },
      bucket: 'material_parent',
    },
    {
      request_id: 'r4',
      reason_code: 'target_not_in_solver',
      reason_message: '',
      request_type: 'socialize_with',
      requester: { cm_id: 1000345, name: 'Ethan Wilson', grade: 8, gender: 'M' },
      requestee: { cm_id: 1000891, name: 'Mia Brown', grade: 8, gender: 'F' },
      detail: { target_cm_id: 1000891, in_roster: false },
      bucket: 'immaterial_parent',
    },
    {
      request_id: 'r5',
      reason_code: 'malformed',
      reason_message: '',
      request_type: 'note',
      requester: { cm_id: 1000678, name: 'Noah Davis', grade: 9, gender: 'M' },
      requestee: null,
      detail: { field: 'internal_notes', parsed: null },
      bucket: 'staff',
    },
  ]
  // Derive by_reason from flat to mirror the backend invariant
  // (_record_item writes both in lockstep). Keeps the fixture consistent
  // with production shape even if `flat` evolves.
  const by_reason: ImpossibilityReport['by_reason'] = {}
  for (const item of flat) {
    ;(by_reason[item.reason_code] ??= []).push(item)
  }
  return {
    // Unique request_ids: r1, r2, r3, r4, r5 = 5
    total_impossible: 5,
    // Unique requester cm_ids: Emma, Olivia, Samuel, Ethan, Noah = 5
    affected_campers: 5,
    by_reason,
    flat,
    // Unique request_ids per bucket: MP {r1, r2, r3} = 3, IMP {r4} = 1, Staff {r5} = 1
    by_bucket_count: { material_parent: 3, immaterial_parent: 1, staff: 1 },
  }
}

// Row helper — find data rows in the body (skip header row).
function bodyRows() {
  return screen.getAllByRole('row').slice(1)
}

// Scoped queries — restrict to the table body to avoid collision with filter
// chips at the top of the modal.
function tbody(): HTMLElement {
  const table = screen.getByRole('table')
  const body = table.querySelector('tbody')
  if (!body) throw new Error('expected a <tbody>')
  return body as HTMLElement
}
function rowChipsByLabel(label: string): HTMLElement[] {
  return within(tbody()).queryAllByText(label)
}

describe('SolverDebugImpossibilityModal — Bucket column', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeRealLocalStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a Bucket column header to the left of Reason', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())
    // Bucket should be the first column, Reason second
    expect(headers[0]?.replace(/[↑↓↕]/g, '').trim()).toBe('Bucket')
    expect(headers[1]?.replace(/[↑↓↕]/g, '').trim()).toBe('Reason')
  })

  it('renders one MP/IMP/STAFF chip per row in the Bucket column', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    // 4 MP rows + 1 IMP row + 1 STAFF row — count within tbody only so the
    // filter chips above the table don't double-count.
    expect(rowChipsByLabel('MP')).toHaveLength(4)
    expect(rowChipsByLabel('IMP')).toHaveLength(1)
    expect(rowChipsByLabel('STAFF')).toHaveLength(1)
  })
})

describe('SolverDebugImpossibilityModal — filter chips', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeRealLocalStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders All/MP/IMP/Staff chips with counts from by_bucket_count', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    // total_impossible=6 for All; per-bucket from by_bucket_count
    expect(screen.getByRole('button', { name: /All\s*5/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^MP\s*3/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^IMP\s*1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Staff\s*1/ })).toBeInTheDocument()
  })

  it('defaults to All-on (all 6 rows visible)', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(bodyRows()).toHaveLength(6)
  })

  it('clicking MP chip isolates table to MP rows only', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^MP\s*3/ }))
    // 4 MP rows visible, IMP/STAFF rows gone (filter chips above the table
    // still show all four — they're persistent navigation, not row markers).
    expect(bodyRows()).toHaveLength(4)
    expect(rowChipsByLabel('IMP')).toHaveLength(0)
    expect(rowChipsByLabel('STAFF')).toHaveLength(0)
  })

  it('clicking MP chip a second time toggles back to All-on', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    const mpChip = screen.getByRole('button', { name: /^MP\s*3/ })
    await user.click(mpChip)
    await user.click(mpChip)
    expect(bodyRows()).toHaveLength(6)
  })

  it('clicking the All chip from any isolated state restores all rows', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^IMP\s*1/ }))
    expect(bodyRows()).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /All\s*5/ }))
    expect(bodyRows()).toHaveLength(6)
  })

  it('clicking a different bucket while isolated switches isolation', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^MP\s*3/ }))
    expect(bodyRows()).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: /^Staff\s*1/ }))
    expect(bodyRows()).toHaveLength(1)
    expect(rowChipsByLabel('STAFF')).toHaveLength(1)
  })
})

describe('SolverDebugImpossibilityModal — filter chip a11y', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeRealLocalStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes selection via aria-pressed so AT can announce the active bucket', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    // Default: All is active
    expect(screen.getByRole('button', { name: /All\s*5/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^MP\s*3/ })).toHaveAttribute('aria-pressed', 'false')
    // Click MP — now MP is active, All is not
    await user.click(screen.getByRole('button', { name: /^MP\s*3/ }))
    expect(screen.getByRole('button', { name: /^MP\s*3/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /All\s*5/ })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('SolverDebugImpossibilityModal — filter localStorage persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeRealLocalStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists isolated state to localStorage', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^MP\s*3/ }))
    expect(window.localStorage.getItem(FILTER_STORAGE_KEY)).toBe('material_parent')
  })

  it('rehydrates the persisted filter on mount', () => {
    window.localStorage.setItem(FILTER_STORAGE_KEY, 'immaterial_parent')
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    // Should land on IMP-only (1 row)
    expect(bodyRows()).toHaveLength(1)
    expect(rowChipsByLabel('IMP')).toHaveLength(1)
  })

  it('falls back to All when localStorage contains an invalid value', () => {
    window.localStorage.setItem(FILTER_STORAGE_KEY, 'nonsense_value')
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(bodyRows()).toHaveLength(6)
  })
})

describe('SolverDebugImpossibilityModal — multi-reason rows', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeRealLocalStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders multi-reason requests as separate rows (Olivia↔Riley appears twice)', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    // Each row uses CamperNameButton which exposes aria-label="Open details for {name}"
    // Olivia is the requester in two rows (grade_compatibility + pair_no_shared_bunk)
    expect(screen.getAllByRole('button', { name: 'Open details for Olivia Chen' }).length).toBe(2)
    expect(screen.getAllByRole('button', { name: 'Open details for Riley Sam' }).length).toBe(2)
  })
})

describe('SolverDebugImpossibilityModal — sortable headers preserved from main', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeRealLocalStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to sort by reason ascending', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    const reasonHeader = screen
      .getAllByRole('columnheader')
      .find((h) => h.textContent?.includes('Reason'))
    expect(reasonHeader).toHaveAttribute('aria-sort', 'ascending')
  })

  it('clicking Camper A header switches sort to name and shows ascending', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /camper a/i }))
    const camperHeader = screen
      .getAllByRole('columnheader')
      .find((h) => h.textContent?.includes('Camper A'))
    expect(camperHeader).toHaveAttribute('aria-sort', 'ascending')
  })

  it('omits aria-sort on an inactive column instead of announcing "none"', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    // Default sort is by reason — Type is inactive and must carry no aria-sort
    // attribute at all, not the previous SortableHeader's 'none'.
    const typeHeader = screen
      .getAllByRole('columnheader')
      .find((h) => h.textContent?.includes('Type'))
    expect(typeHeader).not.toHaveAttribute('aria-sort')
  })
})

describe('SolverDebugImpossibilityModal — preserved behavior from main', () => {
  // navigator.clipboard / window.isSecureContext / document.execCommand are
  // mutated via Object.defineProperty in the Copy JSON tests. vi.unstubAllGlobals
  // does not restore those, so capture the original descriptors in beforeEach
  // and re-apply them in afterEach to keep tests order-independent.
  let savedClipboard: PropertyDescriptor | undefined
  let savedIsSecureContext: PropertyDescriptor | undefined
  let savedExecCommand: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.stubGlobal('localStorage', makeRealLocalStorage())
    savedClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    savedIsSecureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
    savedExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    if (savedClipboard) Object.defineProperty(navigator, 'clipboard', savedClipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
    if (savedIsSecureContext) Object.defineProperty(window, 'isSecureContext', savedIsSecureContext)
    else Reflect.deleteProperty(window, 'isSecureContext')
    if (savedExecCommand) Object.defineProperty(document, 'execCommand', savedExecCommand)
    else Reflect.deleteProperty(document, 'execCommand')
  })

  it('renders the green "no issues" block when total_impossible is zero', () => {
    const empty: ImpossibilityReport = {
      total_impossible: 0,
      affected_campers: 0,
      by_reason: {},
      flat: [],
      by_bucket_count: {},
    }
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={empty}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(screen.getByText(/no issues detected/i)).toBeInTheDocument()
  })

  it('exposes an accessible name on the dialog (aria-label)', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    // Modal uses a custom header slot, so it must thread an explicit aria-label
    // for screen readers — see Modal.tsx contract.
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/impossibility/i)
  })

  it('Copy JSON shows a failure state when both clipboard paths fail', async () => {
    const user = userEvent.setup()
    // No clipboard, not in a secure context, no execCommand → both paths fail.
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    const execMock = vi.fn().mockReturnValue(false)
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execMock })
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /copy json/i }))
    // The button label flips to a visible failure state instead of staying idle.
    expect(screen.getByRole('button', { name: /copy failed/i })).toBeInTheDocument()
  })

  it('renders the red stuck-banner above the table when mp_campers_entirely_impossible is non-empty', () => {
    const report: ImpossibilityReport = {
      ...makeReport(),
      mp_campers_entirely_impossible: [
        {
          cm_id: 1000123,
          name: 'Emma Johnson',
          grade: 8,
          gender: 'F',
          reason_codes: ['cross_session'],
          session_cm_id: 1000001,
        },
      ],
    }
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={report}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(screen.getByText(/1 entirely-impossible MP campers/)).toBeInTheDocument()
  })

  it('Copy JSON button copies the full unfiltered report even when filter is isolated', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    // The component routes through navigator.clipboard only when both the
    // clipboard API is present AND the page is in a secure context. jsdom
    // defaults isSecureContext to false, so stub it true for this test.
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true,
    })
    const report = makeReport()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={report}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^Staff\s*1/ })) // isolate to staff
    await user.click(screen.getByRole('button', { name: /copy json/i }))
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(report, null, 2))
  })

  it('Copy JSON falls back to execCommand when not in a secure context (LAN HTTP)', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    })
    // jsdom doesn't define document.execCommand by default — install it as a
    // mock before spying, then restore afterward.
    const execMock = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execMock,
    })
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /copy json/i }))
    expect(execMock).toHaveBeenCalledWith('copy')
  })

  it('wraps every camper name with CamperNameButton', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    // Sample two: Emma (requester in r1) and Mia Brown (requestee in r4)
    expect(
      screen.getByRole('button', { name: 'Open details for Emma Johnson' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open details for Mia Brown' })).toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — defensive rendering', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeRealLocalStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders chips without crashing when by_bucket_count is missing from the response', () => {
    // Simulates a stale or partially-marshalled API response that omits
    // by_bucket_count. The modal must fall back to 0 per chip, not throw
    // "Cannot read properties of undefined (reading 'material_parent')".
    const report = {
      total_impossible: 1,
      affected_campers: 1,
      by_reason: {},
      flat: [
        {
          request_id: 'r1',
          reason_code: 'cross_session',
          reason_message: '',
          request_type: 'bunk_with',
          requester: { cm_id: 1000123, name: 'Emma Johnson', grade: 8, gender: 'F' },
          requestee: { cm_id: 1000456, name: 'Liam Garcia', grade: 9, gender: 'M' },
          detail: {},
          bucket: 'material_parent',
        },
      ],
      // by_bucket_count intentionally omitted
    } as unknown as ImpossibilityReport
    expect(() =>
      render(
        <SolverDebugImpossibilityModal
          isOpen
          onClose={() => {}}
          report={report}
          sessionCmId={12}
          year={2026}
        />
      )
    ).not.toThrow()
    // Filter chips still render (with fallback "0" counts)
    expect(screen.getByRole('button', { name: /^MP/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^IMP/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Staff/ })).toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — bucket=null handling', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeRealLocalStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders bucket=null rows with em-dash in the Bucket column when filter=all', () => {
    const report: ImpossibilityReport = {
      total_impossible: 1,
      affected_campers: 1,
      by_reason: {},
      flat: [
        {
          request_id: 'r1',
          reason_code: 'cross_session',
          reason_message: '',
          request_type: 'bunk_with',
          requester: { cm_id: 1000123, name: 'Emma Johnson', grade: 8, gender: 'F' },
          requestee: { cm_id: 1000456, name: 'Liam Garcia', grade: 9, gender: 'M' },
          detail: {},
          bucket: null,
        },
      ],
      by_bucket_count: {},
    }
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={report}
        sessionCmId={12}
        year={2026}
      />
    )
    const rows = bodyRows()
    expect(rows).toHaveLength(1)
    const firstRow = rows[0]
    if (!firstRow) throw new Error('expected one row')
    // The Bucket cell of the row uses an em-dash placeholder
    const cells = within(firstRow).getAllByRole('cell')
    expect(cells[0]?.textContent).toBe('—')
  })

  it('hides bucket=null rows when an isolated bucket filter is active', async () => {
    const user = userEvent.setup()
    const report: ImpossibilityReport = {
      total_impossible: 2,
      affected_campers: 2,
      by_reason: {},
      flat: [
        {
          request_id: 'r1',
          reason_code: 'cross_session',
          reason_message: '',
          request_type: 'bunk_with',
          requester: { cm_id: 1000123, name: 'Emma Johnson', grade: 8, gender: 'F' },
          requestee: { cm_id: 1000456, name: 'Liam Garcia', grade: 9, gender: 'M' },
          detail: {},
          bucket: 'material_parent',
        },
        {
          request_id: 'r2',
          reason_code: 'malformed',
          reason_message: '',
          request_type: 'note',
          requester: { cm_id: 1000678, name: 'Noah Davis', grade: 9, gender: 'M' },
          requestee: null,
          detail: {},
          bucket: null,
        },
      ],
      by_bucket_count: { material_parent: 1 },
    }
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={report}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(bodyRows()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /^MP\s*1/ }))
    expect(bodyRows()).toHaveLength(1)
    expect(screen.queryByText('Noah Davis')).not.toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — off-roster requester (kindred#2689)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeRealLocalStorage())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks unknown grade and gender rather than rendering empty debug fields', () => {
    // impossibility.py emits requester={"cm_id": ...} when the requester person
    // is not in the solver's roster. kindred#2692 fixed the name here but left
    // the debug parenthetical rendering "(999/g/)" -- the positional shape with
    // its values missing. kindred#2692 scan, finding 2.
    const report: ImpossibilityReport = {
      total_impossible: 1,
      affected_campers: 1,
      by_reason: {},
      flat: [
        {
          request_id: 'r_off',
          reason_code: 'malformed',
          reason_message: 'missing requestee_id',
          request_type: 'bunk_with',
          requester: { cm_id: 999 },
          requestee: null,
          detail: {},
          bucket: 'material_parent',
        },
      ],
    }
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={report}
        sessionCmId={12}
        year={2026}
      />
    )
    // The modal portals out of the render container, so query the document.
    const text = document.body.textContent ?? ''
    expect(screen.getByRole('button', { name: /#999/ })).toBeInTheDocument()
    // The positional debug triple keeps its shape, with "?" where a value is
    // absent -- never "g/" followed by nothing.
    expect(text).toContain('(999/g?/?)')
    expect(text).not.toMatch(/\(999\/g\/\)/)
  })
})
