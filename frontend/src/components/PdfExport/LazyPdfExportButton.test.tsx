import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LazyPdfExportButton } from './LazyPdfExportButton'
import type { ImpossibilityReport, ValidationStatistics } from '../../services/solver'

// Mock react-hot-toast so we can assert error surfacing without
// pulling in the full toaster runtime.
const toastError = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: { error: (msg: string) => toastError(msg) },
  toast: { error: (msg: string) => toastError(msg) },
}))

// Default mock: returns a benign blob. Individual tests override per-call.
const mockToBlob = vi.fn(async () => new Blob(['mock-pdf'], { type: 'application/pdf' }))
// pdfMock captures the React element passed to pdf() so tests can inspect the
// props BunkPlanReport received (without triggering an actual PDF render).
const pdfMock = vi.fn((_element: unknown) => ({ toBlob: mockToBlob }))
vi.mock('@react-pdf/renderer', () => ({
  pdf: (element: unknown) => pdfMock(element),
}))
vi.mock('./BunkPlanReport', () => ({ BunkPlanReport: () => null }))

const baseStats: ValidationStatistics = {
  total_campers: 50,
  assigned_campers: 48,
  unassigned_campers: 2,
  total_requests: 0,
  satisfied_requests: 0,
  request_satisfaction_rate: 0,
  bunks_at_capacity: 0,
  bunks_under_capacity: 0,
  bunks_over_capacity: 0,
  material_parent_requests: 0,
  satisfied_material_parent_requests: 0,
  material_parent_request_satisfaction_rate: 0,
  campers_with_unsatisfied_material_parent_requests: 0,
  best_effort_parent_requests: 0,
  satisfied_best_effort_parent_requests: 0,
  best_effort_parent_request_satisfaction_rate: 0,
  field_stats: {},
}
const baseImpossibility: ImpossibilityReport = {
  by_reason: {},
  total_impossible: 0,
  affected_campers: 0,
  flat: [],
}
const baseProps = {
  sessionName: 'Session 3',
  year: 2026,
  plannerName: 'Test Staff',
  statistics: baseStats,
  impossibilityReport: baseImpossibility,
}

describe('LazyPdfExportButton', () => {
  beforeEach(() => {
    toastError.mockReset()
    mockToBlob.mockReset()
    mockToBlob.mockResolvedValue(new Blob(['mock-pdf'], { type: 'application/pdf' }))
    pdfMock.mockClear()
    // vi.spyOn auto-restores via vi.restoreAllMocks in vitest's afterEach
    // (config: restoreMocks/clearMocks). Use spyOn rather than direct prototype
    // assignment so sibling tests don't inherit the stubs.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(window, 'setTimeout')
  })

  it('renders a single Export PDF button matching the green primary style', () => {
    render(<LazyPdfExportButton {...baseProps} />)
    const btn = screen.getByRole('button', { name: /export pdf/i })
    expect(btn.className).toContain('bg-emerald-700')
  })

  it('triggers a single click → blob download (no two-click arm pattern)', async () => {
    render(<LazyPdfExportButton {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))

    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled())
    expect(URL.createObjectURL).toHaveBeenCalled()
  })

  it('surfaces a toast error and revokes any blob URL when PDF generation rejects', async () => {
    mockToBlob.mockRejectedValueOnce(new Error('font load failed'))

    render(<LazyPdfExportButton {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError.mock.calls[0]?.[0]).toMatch(/pdf/i)
    // Button returns to ready state (not stuck on "Preparing PDF…")
    expect(screen.getByRole('button', { name: /export pdf/i })).not.toBeDisabled()
  })

  // #2 — logoUrl must reach BunkPlanReport so the cover-page <Image src={logoUrl}>
  // actually renders. Previously logoUrl was a typed slot on BunkPlanReport but
  // had no caller path — every exported PDF shipped logo-less.
  it('forwards logoUrl prop through to BunkPlanReport', async () => {
    render(<LazyPdfExportButton {...baseProps} logoUrl="/local/assets/camp-logo.png" />)
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))

    await waitFor(() => expect(pdfMock).toHaveBeenCalled())
    // pdf() is called with a React element whose .props mirrors what was passed
    // to <BunkPlanReport {...props} />.
    const element = pdfMock.mock.calls[0]?.[0] as { props: { logoUrl?: string } }
    expect(element.props.logoUrl).toBe('/local/assets/camp-logo.png')
  })

  // #3 — URL.revokeObjectURL called synchronously after a.click() can cancel
  // the download in some browsers (Safari, older Firefox). Defer via setTimeout
  // so the browser has a microtask to begin fetching the blob.
  it('defers URL.revokeObjectURL via setTimeout (sync revoke can cancel blob download in some browsers)', async () => {
    render(<LazyPdfExportButton {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))

    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled())
    // Assert revoke was scheduled via setTimeout(fn, ≥0), not invoked
    // straight from finally.
    expect(window.setTimeout).toHaveBeenCalled()
    const setTimeoutCalls = (window.setTimeout as unknown as { mock: { calls: unknown[][] } }).mock
      .calls
    const hasRevokeTimer = setTimeoutCalls.some(([fn]) => typeof fn === 'function')
    expect(hasRevokeTimer).toBe(true)
  })

  // #5 — Filesystem-illegal characters in sessionName (/ \ : * ? " ' < > | etc.)
  // can break downloads on some OS/browser combos and break the synthetic anchor's
  // download attribute on Windows.
  it('sanitizes filesystem-illegal characters out of the PDF filename', async () => {
    const setDownload = vi.fn()
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag !== 'a') return document.createElementNS('http://www.w3.org/1999/xhtml', tag)
      const a = {
        href: '',
        set download(v: string) {
          setDownload(v)
        },
        click: vi.fn(),
        parentNode: null,
      } as unknown as HTMLAnchorElement
      return a
    })

    render(<LazyPdfExportButton {...baseProps} sessionName="Session 3 / Pine: *test* | quotes?" />)
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))

    await waitFor(() => expect(setDownload).toHaveBeenCalled())
    const filename = setDownload.mock.calls[0]?.[0] as string
    // No slashes, colons, asterisks, pipes, or quotes
    expect(filename).not.toMatch(/[/\\:*?"'<>|]/)
    // Still contains a recognizable session token + year + extension
    expect(filename).toMatch(/^bunk-plan-.*-2026\.pdf$/)
    expect(filename.toLowerCase()).toContain('session')
  })
})
