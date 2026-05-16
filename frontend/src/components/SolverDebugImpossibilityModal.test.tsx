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

// Three-item report covering all three buckets — used by most filter tests.
function makeThreeBucketReport(): ImpossibilityReport {
  return {
    total_impossible: 3,
    affected_campers: 5,
    by_reason: {},
    flat: [
      {
        request_id: 'r1',
        reason_code: 'cross_session',
        reason_message: 'cross-session',
        request_type: 'bunk_with',
        requester: { cm_id: 1000123, name: 'Emma Johnson', grade: 8, gender: 'F' },
        requestee: { cm_id: 1000456, name: 'Liam Garcia', grade: 9, gender: 'M' },
        detail: { req_sess: 12, target_sess: 13 },
        bucket: 'material_parent',
      },
      {
        request_id: 'r2',
        reason_code: 'target_not_in_solver',
        reason_message: 'target absent',
        request_type: 'socialize_with',
        requester: { cm_id: 1000345, name: 'Ethan Wilson', grade: 8, gender: 'M' },
        requestee: { cm_id: 1000891, name: 'Mia Brown', grade: 8, gender: 'F' },
        detail: { target_cm_id: 1000891, in_roster: false },
        bucket: 'immaterial_parent',
      },
      {
        request_id: 'r3',
        reason_code: 'malformed',
        reason_message: 'malformed note',
        request_type: 'note',
        requester: { cm_id: 1000678, name: 'Noah Davis', grade: 9, gender: 'M' },
        requestee: null,
        detail: { field: 'internal_notes', parsed: null },
        bucket: 'staff',
      },
    ],
    by_bucket_count: { material_parent: 1, immaterial_parent: 1, staff: 1 },
  }
}

describe('SolverDebugImpossibilityModal — filter chip state machine', () => {
  let realStorage: ReturnType<typeof makeRealLocalStorage>

  beforeEach(() => {
    realStorage = makeRealLocalStorage()
    vi.stubGlobal('localStorage', realStorage)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to all-on (renders all three bucket sections)', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeThreeBucketReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(screen.getByRole('region', { name: /^material parent$/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^immaterial parent$/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^staff$/i })).toBeInTheDocument()
  })

  it('clicking MP chip isolates to MP-only', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeThreeBucketReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^mp/i }))
    expect(screen.getByRole('region', { name: /^material parent$/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^immaterial parent$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^staff$/i })).not.toBeInTheDocument()
  })

  it('clicking the All chip after isolation restores all sections', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeThreeBucketReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^mp/i }))
    await user.click(screen.getByRole('button', { name: /^all/i }))
    expect(screen.getByRole('region', { name: /^material parent$/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^immaterial parent$/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^staff$/i })).toBeInTheDocument()
  })

  it('clicking an isolated bucket again returns to all-on', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeThreeBucketReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^mp/i })) // isolate
    await user.click(screen.getByRole('button', { name: /^mp/i })) // toggle off → all-on
    expect(screen.getByRole('region', { name: /^immaterial parent$/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^staff$/i })).toBeInTheDocument()
  })

  it('clicking a different bucket while isolated switches the isolation', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeThreeBucketReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^mp/i }))
    await user.click(screen.getByRole('button', { name: /^imp/i }))
    expect(screen.queryByRole('region', { name: /^material parent$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^immaterial parent$/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^staff$/i })).not.toBeInTheDocument()
  })

  it('persists isolated state to localStorage and restores it on remount', async () => {
    const user = userEvent.setup()
    const props = {
      isOpen: true,
      onClose: () => {},
      report: makeThreeBucketReport(),
      sessionCmId: 12,
      year: 2026,
    }
    const { unmount } = render(<SolverDebugImpossibilityModal {...props} />)
    await user.click(screen.getByRole('button', { name: /^staff/i }))
    expect(localStorage.getItem(FILTER_STORAGE_KEY)).toBe('staff')
    unmount()

    render(<SolverDebugImpossibilityModal {...props} />)
    expect(screen.queryByRole('region', { name: /^material parent$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^staff$/i })).toBeInTheDocument()
  })

  it('renders "from last open" indicator when persisted state is not all-on', () => {
    localStorage.setItem(FILTER_STORAGE_KEY, 'material_parent')
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeThreeBucketReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(screen.getByText(/from last open/i)).toBeInTheDocument()
  })

  it('omits "from last open" indicator when state is all-on', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeThreeBucketReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(screen.queryByText(/from last open/i)).not.toBeInTheDocument()
  })

  it('falls back to all-on when localStorage contains an invalid value', () => {
    localStorage.setItem(FILTER_STORAGE_KEY, 'totally_bogus_value')
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={makeThreeBucketReport()}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(screen.getByRole('region', { name: /^material parent$/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^immaterial parent$/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^staff$/i })).toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — bucket sections + grouped rows', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('renders one row per request_id with multi-reason chips stacked', () => {
    const report: ImpossibilityReport = {
      total_impossible: 1,
      affected_campers: 2,
      by_reason: {},
      flat: [
        {
          request_id: 'r1',
          reason_code: 'pair_no_shared_bunk',
          reason_message: 'no shared bunk',
          request_type: 'bunk_with',
          requester: { cm_id: 1000789, name: 'Olivia Chen', grade: 7, gender: 'F' },
          requestee: { cm_id: 1000234, name: 'Riley Sam', grade: 7, gender: 'F' },
          detail: { shared_bunks: 0 },
          bucket: 'material_parent',
        },
        {
          request_id: 'r1',
          reason_code: 'grade_compatibility',
          reason_message: 'grade gap',
          request_type: 'bunk_with',
          requester: { cm_id: 1000789, name: 'Olivia Chen', grade: 7, gender: 'F' },
          requestee: { cm_id: 1000234, name: 'Riley Sam', grade: 7, gender: 'F' },
          detail: { grade_a: 7, grade_b: 7, span: 0 },
          bucket: 'material_parent',
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
    const section = screen.getByRole('region', { name: /^material parent$/i })
    // Exactly one CamperNameButton labeled "Olivia Chen" in the row area
    const oliviaButtons = within(section).getAllByRole('button', { name: /Olivia Chen/ })
    expect(oliviaButtons).toHaveLength(1)
    // Both reason chips present in the single row
    expect(within(section).getByText('pair_no_shared_bunk')).toBeInTheDocument()
    expect(within(section).getByText('grade_compatibility')).toBeInTheDocument()
  })

  it('orders reason sub-rows alphabetically by reason_code', () => {
    const report: ImpossibilityReport = {
      total_impossible: 1,
      affected_campers: 2,
      by_reason: {},
      flat: [
        {
          request_id: 'r1',
          reason_code: 'pair_no_shared_bunk',
          reason_message: '',
          request_type: 'bunk_with',
          requester: { cm_id: 1000789, name: 'Olivia Chen', grade: 7, gender: 'F' },
          requestee: { cm_id: 1000234, name: 'Riley Sam', grade: 7, gender: 'F' },
          detail: { shared_bunks: 0 },
          bucket: 'material_parent',
        },
        {
          request_id: 'r1',
          reason_code: 'grade_compatibility',
          reason_message: '',
          request_type: 'bunk_with',
          requester: { cm_id: 1000789, name: 'Olivia Chen', grade: 7, gender: 'F' },
          requestee: { cm_id: 1000234, name: 'Riley Sam', grade: 7, gender: 'F' },
          detail: { span: 0 },
          bucket: 'material_parent',
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
    const section = screen.getByRole('region', { name: /^material parent$/i })
    const chipTexts = within(section)
      .getAllByText(/grade_compatibility|pair_no_shared_bunk/)
      .map((el) => el.textContent ?? '')
    expect(chipTexts[0]).toBe('grade_compatibility')
    expect(chipTexts[1]).toBe('pair_no_shared_bunk')
  })

  it('renders inline k=v detail with amber keys', () => {
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
          detail: { req_sess: 12, target_sess: 13 },
          bucket: 'material_parent',
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
    expect(screen.getByText('req_sess')).toBeInTheDocument()
    expect(screen.getByText('target_sess')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('13')).toBeInTheDocument()
    // Key has amber color class
    expect(screen.getByText('req_sess')).toHaveClass('text-amber-700')
  })

  it('hides empty bucket sections but their chip still shows 0 count', () => {
    const report: ImpossibilityReport = {
      total_impossible: 1,
      affected_campers: 1,
      by_reason: {},
      flat: [
        {
          request_id: 'r1',
          reason_code: 'malformed',
          reason_message: '',
          request_type: 'note',
          requester: { cm_id: 1000678, name: 'Noah Davis', grade: 9, gender: 'M' },
          requestee: null,
          detail: { field: 'internal_notes' },
          bucket: 'staff',
        },
      ],
      by_bucket_count: { staff: 1 },
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
    expect(screen.queryByRole('region', { name: /^material parent$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^immaterial parent$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^staff$/i })).toBeInTheDocument()
    // MP chip still renders with 0
    const mpChip = screen.getByRole('button', { name: /^mp/i })
    expect(mpChip).toHaveTextContent('0')
  })
})

describe('SolverDebugImpossibilityModal — MP stuck-block + row pinning', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('renders stuck-block under MP section header when mp_campers_entirely_impossible is non-empty', () => {
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
          detail: { req_sess: 12 },
          bucket: 'material_parent',
        },
      ],
      mp_campers_entirely_impossible: [
        {
          cm_id: 1000123,
          name: 'Emma Johnson',
          grade: 8,
          gender: 'F',
          reason_codes: ['cross_session'],
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
    const section = screen.getByRole('region', { name: /^material parent$/i })
    const stuckBlock = within(section).getByTestId('mp-stuck-block')
    expect(within(stuckBlock).getByText(/Emma Johnson/)).toBeInTheDocument()
    expect(within(stuckBlock).getByText('cross_session')).toBeInTheDocument()
  })

  it('omits the stuck-block when mp_campers_entirely_impossible is empty', () => {
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
          bucket: 'material_parent',
        },
      ],
      mp_campers_entirely_impossible: [],
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
    expect(screen.queryByTestId('mp-stuck-block')).not.toBeInTheDocument()
  })

  it('pins stuck request rows to the top of the MP section', () => {
    const report: ImpossibilityReport = {
      total_impossible: 2,
      affected_campers: 4,
      by_reason: {},
      flat: [
        // Aaron is alphabetically earlier but NOT stuck → must appear AFTER Emma
        {
          request_id: 'r_aaron',
          reason_code: 'pair_no_shared_bunk',
          reason_message: '',
          request_type: 'bunk_with',
          requester: { cm_id: 999, name: 'Aaron Brown', grade: 7, gender: 'M' },
          requestee: { cm_id: 998, name: 'Mason Lee', grade: 7, gender: 'M' },
          detail: { shared_bunks: 0 },
          bucket: 'material_parent',
        },
        {
          request_id: 'r_emma',
          reason_code: 'cross_session',
          reason_message: '',
          request_type: 'bunk_with',
          requester: { cm_id: 1000123, name: 'Emma Johnson', grade: 8, gender: 'F' },
          requestee: { cm_id: 1000456, name: 'Liam Garcia', grade: 9, gender: 'M' },
          detail: { req_sess: 12 },
          bucket: 'material_parent',
        },
      ],
      mp_campers_entirely_impossible: [
        {
          cm_id: 1000123,
          name: 'Emma Johnson',
          grade: 8,
          gender: 'F',
          reason_codes: ['cross_session'],
        },
      ],
      by_bucket_count: { material_parent: 2 },
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
    const section = screen.getByRole('region', { name: /^material parent$/i })
    const rows = within(section).getAllByRole('row')
    // First data row (excluding the stuck-block, which is a div) is Emma's
    expect(within(rows[0]!).getByText(/Emma Johnson/)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/Aaron Brown/)).toBeInTheDocument()
  })

  it('marks stuck rows with bg-red-50 class and 🛑 prefix', () => {
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
          bucket: 'material_parent',
        },
      ],
      mp_campers_entirely_impossible: [
        {
          cm_id: 1000123,
          name: 'Emma Johnson',
          grade: 8,
          gender: 'F',
          reason_codes: ['cross_session'],
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
    const section = screen.getByRole('region', { name: /^material parent$/i })
    const row = within(section).getAllByRole('row')[0]!
    expect(row).toHaveClass('bg-red-50')
    expect(within(row).getByText(/🛑/)).toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — edge cases', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('renders the green "no issues" block when total_impossible is zero', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={{
          total_impossible: 0,
          affected_campers: 0,
          by_reason: {},
          flat: [],
          by_bucket_count: {},
        }}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(screen.getByText(/no issues detected/i)).toBeInTheDocument()
  })

  it('shows the empty-bucket placeholder when isolated to an empty bucket', async () => {
    const user = userEvent.setup()
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
          bucket: 'material_parent',
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
    await user.click(screen.getByRole('button', { name: /^staff/i }))
    expect(screen.getByText(/No impossibilities in this bucket/i)).toBeInTheDocument()
  })

  it('renders an Unbucketed section for items with bucket=null', () => {
    const report: ImpossibilityReport = {
      total_impossible: 1,
      affected_campers: 1,
      by_reason: {},
      flat: [
        {
          request_id: 'r1',
          reason_code: 'malformed',
          reason_message: '',
          request_type: 'note',
          requester: { cm_id: 1000678, name: 'Noah Davis', grade: 9, gender: 'M' },
          requestee: null,
          detail: { field: 'unknown_field_value' },
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
    const section = screen.getByRole('region', { name: /unbucketed/i })
    expect(within(section).getByText(/Noah Davis/)).toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — preserved behavior', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('wraps every camper name (pair + stuck-block) with CamperNameButton', () => {
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
          bucket: 'material_parent',
        },
      ],
      mp_campers_entirely_impossible: [
        {
          cm_id: 1000123,
          name: 'Emma Johnson',
          grade: 8,
          gender: 'F',
          reason_codes: ['cross_session'],
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
    // CamperNameButton exposes aria-label="Open details for {name}".
    // Emma appears in both the stuck-block AND the pinned pair row → ≥ 2 buttons.
    // Liam appears only in the pair row → exactly 1 button.
    expect(
      screen.getAllByRole('button', { name: 'Open details for Emma Johnson' }).length
    ).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: 'Open details for Liam Garcia' })).toBeInTheDocument()
  })

  it('Copy JSON button copies the full unfiltered report even when filter is isolated', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const report = makeThreeBucketReport()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={report}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^staff/i })) // isolate to staff
    await user.click(screen.getByRole('button', { name: /copy json/i }))
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(report, null, 2))
  })
})

// ---------- new safety-net behaviors ----------

function reportWithStuckCamper(): ImpossibilityReport {
  return {
    total_impossible: 3,
    affected_campers: 5,
    by_reason: {},
    flat: [
      {
        request_id: 'r_mp',
        reason_code: 'cross_session',
        reason_message: '',
        request_type: 'bunk_with',
        requester: { cm_id: 1000123, name: 'Emma Johnson', grade: 8, gender: 'F' },
        requestee: { cm_id: 1000456, name: 'Liam Garcia', grade: 9, gender: 'M' },
        detail: {},
        bucket: 'material_parent',
      },
      {
        request_id: 'r_imp',
        reason_code: 'target_not_in_solver',
        reason_message: '',
        request_type: 'socialize_with',
        requester: { cm_id: 1000345, name: 'Ethan Wilson', grade: 8, gender: 'M' },
        requestee: { cm_id: 1000891, name: 'Mia Brown', grade: 8, gender: 'F' },
        detail: {},
        bucket: 'immaterial_parent',
      },
      {
        request_id: 'r_staff',
        reason_code: 'malformed',
        reason_message: '',
        request_type: 'note',
        requester: { cm_id: 1000678, name: 'Noah Davis', grade: 9, gender: 'M' },
        requestee: null,
        detail: {},
        bucket: 'staff',
      },
    ],
    mp_campers_entirely_impossible: [
      {
        cm_id: 1000123,
        name: 'Emma Johnson',
        grade: 8,
        gender: 'F',
        reason_codes: ['cross_session'],
      },
    ],
    by_bucket_count: { material_parent: 1, immaterial_parent: 1, staff: 1 },
  }
}

describe('SolverDebugImpossibilityModal — stuck rollup visibility across filters', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('shows in-section stuck-block when filter=all (no hoisted duplicate)', () => {
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={reportWithStuckCamper()}
        sessionCmId={12}
        year={2026}
      />
    )
    expect(screen.getByTestId('mp-stuck-block')).toBeInTheDocument()
    expect(screen.queryByTestId('mp-stuck-block-hoisted')).not.toBeInTheDocument()
  })

  it('shows in-section stuck-block when filter=material_parent (no hoisted duplicate)', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={reportWithStuckCamper()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^mp/i }))
    expect(screen.getByTestId('mp-stuck-block')).toBeInTheDocument()
    expect(screen.queryByTestId('mp-stuck-block-hoisted')).not.toBeInTheDocument()
  })

  it('hoists stuck-block above bucket sections when filter=immaterial_parent', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={reportWithStuckCamper()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^imp/i }))
    const hoisted = screen.getByTestId('mp-stuck-block-hoisted')
    expect(hoisted).toBeInTheDocument()
    // The in-section block is gone because the MP section itself is hidden.
    expect(screen.queryByTestId('mp-stuck-block')).not.toBeInTheDocument()
    expect(within(hoisted).getByText(/Emma Johnson/)).toBeInTheDocument()
  })

  it('hoists stuck-block above bucket sections when filter=staff', async () => {
    const user = userEvent.setup()
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={reportWithStuckCamper()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^staff/i }))
    expect(screen.getByTestId('mp-stuck-block-hoisted')).toBeInTheDocument()
    expect(screen.queryByTestId('mp-stuck-block')).not.toBeInTheDocument()
  })

  it('omits both stuck-blocks when mp_campers_entirely_impossible is empty', async () => {
    const user = userEvent.setup()
    const report = reportWithStuckCamper()
    report.mp_campers_entirely_impossible = []
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={report}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^staff/i }))
    expect(screen.queryByTestId('mp-stuck-block')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mp-stuck-block-hoisted')).not.toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — localStorage failure safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function throwingStorage(failOn: 'get' | 'set') {
    return {
      getItem: () => {
        if (failOn === 'get') throw new Error('SecurityError: storage disabled')
        return null
      },
      setItem: () => {
        if (failOn === 'set') throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      get length() {
        return 0
      },
    }
  }

  it('falls back to all-on when localStorage.getItem throws', () => {
    vi.stubGlobal('localStorage', throwingStorage('get'))
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={reportWithStuckCamper()}
        sessionCmId={12}
        year={2026}
      />
    )
    // All three sections render because filter defaulted to 'all'.
    expect(screen.getByRole('region', { name: /^material parent$/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^immaterial parent$/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^staff$/i })).toBeInTheDocument()
  })

  it('does not crash on chip click when localStorage.setItem throws', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('localStorage', throwingStorage('set'))
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={reportWithStuckCamper()}
        sessionCmId={12}
        year={2026}
      />
    )
    await user.click(screen.getByRole('button', { name: /^mp/i }))
    // Click succeeded → MP isolated, IMP/Staff sections gone.
    expect(screen.getByRole('region', { name: /^material parent$/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /^immaterial parent$/i })).not.toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — unknown bucket runtime guard', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('routes items with unknown bucket strings to Unbucketed without crashing', () => {
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
          // Simulate a backend that emits a bucket value the frontend doesn't recognize.
          bucket: 'newly_added_bucket' as unknown as 'material_parent',
        },
      ],
      by_bucket_count: {},
    } as ImpossibilityReport
    render(
      <SolverDebugImpossibilityModal
        isOpen
        onClose={() => {}}
        report={report}
        sessionCmId={12}
        year={2026}
      />
    )
    const section = screen.getByRole('region', { name: /unbucketed/i })
    expect(within(section).getByText(/Emma Johnson/)).toBeInTheDocument()
  })
})

describe('SolverDebugImpossibilityModal — compactDetail nested object rendering', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('serializes nested object detail values as JSON, not [object Object]', () => {
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
          detail: { pool: { min: 5, max: 8 } },
          bucket: 'material_parent',
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
    expect(screen.getByText('{"min":5,"max":8}')).toBeInTheDocument()
    expect(screen.queryByText(/\[object Object\]/)).not.toBeInTheDocument()
  })
})
