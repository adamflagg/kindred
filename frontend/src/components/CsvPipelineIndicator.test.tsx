import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CsvPipelineIndicator from './CsvPipelineIndicator'
import type { PipelinePhase } from '../services/csvPipelineStatus'

const mockToast = { success: vi.fn() }
vi.mock('react-hot-toast', () => ({
  default: { success: (...args: unknown[]) => mockToast.success(...args) },
}))

const mockUseStatus = vi.fn()
vi.mock('../hooks/useCsvPipelineStatus', () => ({
  useCsvPipelineStatus: () =>
    mockUseStatus() as { data: PipelinePhase | undefined; isLoading: boolean; isError: boolean },
}))

// Use real localStorage for these tests (the global setup mocks it with vi.fn())
const realLocalStorage = (() => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    length: 0,
    key: vi.fn(),
  }
})()

beforeAll(() => {
  vi.stubGlobal('localStorage', realLocalStorage)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  mockUseStatus.mockReset()
  mockToast.success.mockReset()
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

function setData(data: PipelinePhase | undefined): void {
  mockUseStatus.mockReturnValue({ data, isLoading: false, isError: false })
}

describe('CsvPipelineIndicator', () => {
  it('renders nothing when phase is idle', () => {
    setData({ phase: 'idle' })
    const { container } = render(<CsvPipelineIndicator />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when data is undefined (initial load)', () => {
    setData(undefined)
    const { container } = render(<CsvPipelineIndicator />)
    expect(container.firstChild).toBeNull()
  })

  it('renders importing label with spinner', () => {
    setData({ phase: 'importing', startedAt: new Date().toISOString() })
    render(<CsvPipelineIndicator />)
    expect(screen.getByText(/Importing CSV/i)).toBeInTheDocument()
  })

  it('renders matching label with spinner', () => {
    setData({ phase: 'matching', startedAt: new Date().toISOString() })
    render(<CsvPipelineIndicator />)
    expect(screen.getByText(/Matching CSV requests/i)).toBeInTheDocument()
  })

  it('renders done state with compact chip summary', () => {
    setData({
      phase: 'done',
      runId: 'r1',
      finishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      counts: { total: 28, autoMatched: 22, needReview: 6 },
    })
    render(<CsvPipelineIndicator />)
    expect(screen.getByText(/Import complete/i)).toBeInTheDocument()
    expect(screen.queryByText(/new or updated requests,/i)).not.toBeInTheDocument()
    const chip = screen.getByText(/Import complete/i)
    expect(chip).toHaveTextContent(/28 new/i)
    expect(chip).toHaveTextContent(/6 review/i)
  })

  it('omits "need review" from button label when needReview is zero', () => {
    setData({
      phase: 'done',
      runId: 'r-zero',
      finishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      counts: { total: 22, autoMatched: 22, needReview: 0 },
    })
    render(<CsvPipelineIndicator />)
    expect(screen.getByText(/Import complete/i)).toBeInTheDocument()
    expect(screen.queryByText(/review/i)).not.toBeInTheDocument()
  })

  it('omits "need review" from completion toast when needReview is zero', () => {
    setData({
      phase: 'done',
      runId: 'r-zero-toast',
      finishedAt: new Date().toISOString(),
      counts: { total: 22, autoMatched: 22, needReview: 0 },
    })
    render(<CsvPipelineIndicator />)
    expect(mockToast.success).toHaveBeenCalledTimes(1)
    expect(mockToast.success).toHaveBeenCalledWith(
      'Import complete: 22 new or updated requests, 22 auto-matched.',
      expect.any(Object)
    )
  })

  it('renders error state with click-for-details copy', () => {
    setData({
      phase: 'error',
      finishedAt: new Date().toISOString(),
      message: 'context deadline exceeded',
    })
    render(<CsvPipelineIndicator />)
    expect(screen.getByText(/Import failed\. Click for details\./i)).toBeInTheDocument()
  })

  it('fires completion toast exactly once per runId', () => {
    setData({
      phase: 'done',
      runId: 'r1',
      finishedAt: new Date().toISOString(),
      counts: { total: 10, autoMatched: 8, needReview: 2 },
    })
    const { rerender } = render(<CsvPipelineIndicator />)
    expect(mockToast.success).toHaveBeenCalledTimes(1)
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.stringContaining(
        'Import complete: 10 new or updated requests, 8 auto-matched, 2 need review'
      ),
      expect.any(Object)
    )
    // Re-render with same data — should NOT toast again
    rerender(<CsvPipelineIndicator />)
    expect(mockToast.success).toHaveBeenCalledTimes(1)
  })

  it('fires a fresh toast when runId changes', () => {
    setData({
      phase: 'done',
      runId: 'r1',
      finishedAt: new Date().toISOString(),
      counts: { total: 1, autoMatched: 1, needReview: 0 },
    })
    const { rerender } = render(<CsvPipelineIndicator />)
    expect(mockToast.success).toHaveBeenCalledTimes(1)
    setData({
      phase: 'done',
      runId: 'r2',
      finishedAt: new Date().toISOString(),
      counts: { total: 5, autoMatched: 5, needReview: 0 },
    })
    rerender(<CsvPipelineIndicator />)
    expect(mockToast.success).toHaveBeenCalledTimes(2)
  })

  it('hides indicator when dismissed runId matches current done runId', () => {
    localStorage.setItem('csvProgressDismissedRunId', 'r1')
    setData({
      phase: 'done',
      runId: 'r1',
      finishedAt: new Date().toISOString(),
      counts: { total: 1, autoMatched: 1, needReview: 0 },
    })
    const { container } = render(<CsvPipelineIndicator />)
    expect(container.firstChild).toBeNull()
  })

  it('still renders when dismissed runId differs from current done runId', () => {
    localStorage.setItem('csvProgressDismissedRunId', 'r1')
    setData({
      phase: 'done',
      runId: 'r2',
      finishedAt: new Date().toISOString(),
      counts: { total: 1, autoMatched: 1, needReview: 0 },
    })
    render(<CsvPipelineIndicator />)
    expect(screen.getByText(/Import complete/i)).toBeInTheDocument()
  })

  it('clicking × stores current runId in dismissed-key and hides indicator', () => {
    setData({
      phase: 'done',
      runId: 'r3',
      finishedAt: new Date().toISOString(),
      counts: { total: 1, autoMatched: 1, needReview: 0 },
    })
    render(<CsvPipelineIndicator />)
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i })
    fireEvent.click(dismissBtn)
    expect(localStorage.getItem('csvProgressDismissedRunId')).toBe('r3')
    // After dismiss, component should render null on next mount with same data
    setData({
      phase: 'done',
      runId: 'r3',
      finishedAt: new Date().toISOString(),
      counts: { total: 1, autoMatched: 1, needReview: 0 },
    })
    const { container: c2 } = render(<CsvPipelineIndicator />)
    expect(c2.firstChild).toBeNull()
  })

  it('clicking the main button toggles a popover', () => {
    setData({ phase: 'importing', startedAt: new Date().toISOString() })
    render(<CsvPipelineIndicator />)
    const btn = screen.getByRole('button', { name: /CSV pipeline status/i })
    fireEvent.click(btn)
    expect(screen.getByRole('region', { name: /pipeline detail/i })).toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.queryByRole('region', { name: /pipeline detail/i })).not.toBeInTheDocument()
  })

  it('closes the popover on outside mousedown', () => {
    setData({ phase: 'importing', startedAt: new Date().toISOString() })
    render(
      <div>
        <CsvPipelineIndicator />
        <button type="button">outside</button>
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: /CSV pipeline status/i }))
    expect(screen.getByRole('region', { name: /pipeline detail/i })).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: /outside/i }))
    expect(screen.queryByRole('region', { name: /pipeline detail/i })).not.toBeInTheDocument()
  })

  it('closes the popover when Escape is pressed', () => {
    setData({ phase: 'importing', startedAt: new Date().toISOString() })
    render(<CsvPipelineIndicator />)
    fireEvent.click(screen.getByRole('button', { name: /CSV pipeline status/i }))
    expect(screen.getByRole('region', { name: /pipeline detail/i })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: /pipeline detail/i })).not.toBeInTheDocument()
  })
})
