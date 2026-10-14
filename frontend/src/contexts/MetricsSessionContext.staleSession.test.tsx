/**
 * Row 14 (#3208): a ?session=<cm_id> that the viewed year doesn't have is
 * mapped to that year's session (or dropped), never left reading zeros.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useSearchParams } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MetricsSessionProvider } from './MetricsSessionContext'
import { CurrentYearContext, type CurrentYearContextType } from '../hooks/useCurrentYear'

const sessionsState = vi.hoisted(() => ({
  value: { data: [] as unknown[], isLoading: false, isPlaceholderData: false },
}))
vi.mock('../hooks/useMetricsSessions', () => ({
  useMetricsSessions: () => sessionsState.value,
}))

const getList = vi.hoisted(() => vi.fn())
vi.mock('../lib/pocketbase', () => ({
  pb: { collection: () => ({ getList }) },
}))

const mk = (cm_id: number, name: string) => ({
  cm_id,
  name,
  session_type: 'embedded',
  start_date: '2026-06-15',
  end_date: '2026-06-20',
})

function UrlViewer() {
  const [p] = useSearchParams()
  return (
    <>
      <span data-testid="url-session">{p.get('session') ?? 'none'}</span>
      <span data-testid="url-view">{p.get('view') ?? 'none'}</span>
    </>
  )
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const year: CurrentYearContextType = {
    currentYear: 2026,
    setCurrentYear: vi.fn(),
    availableYears: [2026, 2025],
    isTransitioning: false,
    isYearReady: true,
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <CurrentYearContext value={year}>
          <MetricsSessionProvider>
            <UrlViewer />
          </MetricsSessionProvider>
        </CurrentYearContext>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('MetricsSessionProvider stale ?session=', () => {
  beforeEach(() => {
    getList.mockReset()
    sessionsState.value = {
      data: [mk(1378702, 'Taste of Camp 1'), mk(1378703, 'Taste of Camp 2')],
      isLoading: false,
      isPlaceholderData: false,
    }
  })

  it('rewrites the id to the viewed year when the session was renamed', async () => {
    getList.mockResolvedValue({ items: [{ cm_id: 1235403, name: 'Taste of Camp', year: 2025 }] })
    renderAt('/analytics/registration?session=1235403')
    await waitFor(() => expect(screen.getByTestId('url-session')).toHaveTextContent('1378702'))
  })

  it('removes the param when nothing in the year matches', async () => {
    getList.mockResolvedValue({ items: [{ cm_id: 777, name: 'Gone Session', year: 2025 }] })
    renderAt('/analytics/registration?session=777')
    await waitFor(() => expect(screen.getByTestId('url-session')).toHaveTextContent('none'))
  })

  it('removes the param when the id is unknown everywhere', async () => {
    getList.mockResolvedValue({ items: [] })
    renderAt('/analytics/registration?session=888')
    await waitFor(() => expect(screen.getByTestId('url-session')).toHaveTextContent('none'))
  })

  it('leaves an id the year has alone and never looks it up', async () => {
    renderAt('/analytics/registration?session=1378703')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('url-session')).toHaveTextContent('1378703')
    expect(getList).not.toHaveBeenCalled()
  })

  it('waits while the sessions are the previous year placeholder', async () => {
    sessionsState.value = {
      data: [mk(1235403, 'Taste of Camp')],
      isLoading: false,
      isPlaceholderData: true,
    }
    renderAt('/analytics/registration?session=1356534')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('url-session')).toHaveTextContent('1356534')
    expect(getList).not.toHaveBeenCalled()
  })

  it('does nothing without a session param', async () => {
    renderAt('/analytics/registration?view=quests')
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('url-view')).toHaveTextContent('quests')
    expect(getList).not.toHaveBeenCalled()
  })
})
