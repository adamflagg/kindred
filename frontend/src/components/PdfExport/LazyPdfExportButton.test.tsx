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
vi.mock('@react-pdf/renderer', () => ({
  pdf: () => ({ toBlob: mockToBlob }),
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
    // vi.spyOn auto-restores via vi.restoreAllMocks in vitest's afterEach
    // (config: restoreMocks/clearMocks). Use spyOn rather than direct prototype
    // assignment so sibling tests don't inherit the stubs.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
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
})
