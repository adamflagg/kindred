import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { LazyPdfExportButton } from './LazyPdfExportButton'

// Mock the lazy imports so the test doesn't pull in @react-pdf/renderer
vi.mock('@react-pdf/renderer', () => ({
  pdf: () => ({ toBlob: async () => new Blob(['mock-pdf'], { type: 'application/pdf' }) }),
}))
vi.mock('./BunkPlanReport', () => ({ BunkPlanReport: () => null }))

describe('LazyPdfExportButton', () => {
  const baseProps = {
    sessionName: 'Session 3',
    year: 2026,
    plannerName: 'Test Staff',
    statistics: { total_campers: 50 } as any,
    impossibilityReport: { by_reason: {}, total_impossible: 0, affected_campers: 0 } as any,
  }

  it('renders a single Export PDF button matching the green primary style', () => {
    render(<LazyPdfExportButton {...baseProps} />)
    const btn = screen.getByRole('button', { name: /export pdf/i })
    expect(btn.className).toContain('bg-emerald-700')
  })

  it('triggers a single click → blob download (no two-click arm pattern)', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const clickSpy = vi.fn()
    HTMLAnchorElement.prototype.click = clickSpy

    render(<LazyPdfExportButton {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /export pdf/i }))

    await waitFor(() => expect(clickSpy).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()
  })
})
