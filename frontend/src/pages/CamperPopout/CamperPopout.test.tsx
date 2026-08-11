import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CamperPopout from './index'

// BunkRequestProvider mocked to avoid PocketBase queries
vi.mock('../../providers/BunkRequestProvider', () => ({
  BunkRequestProvider: ({ children }: { sessionCmId: number; children: React.ReactNode }) => (
    <div data-testid="bunk-request-provider">{children}</div>
  ),
}))

// LazyCamperDetailsPanel mocked per CamperDetailsPanel.test.tsx embedded-mode pattern
vi.mock('../../components/impossibility/LazyCamperDetailsPanel', () => ({
  LazyCamperDetailsPanel: ({
    camperId,
    embedded,
    onClose,
  }: {
    camperId: string
    embedded?: boolean
    onClose: () => void
  }) => (
    // Test double standing in for LazyCamperDetailsPanel — never rendered to
    // real users, so it doesn't need the interactive semantics the real
    // (already-accessible) panel has. `onClick` just gives the test a
    // synthetic hook to fire the `onClose` callback through.
    <div
      data-testid="camper-details-panel"
      data-camper-id={camperId}
      data-embedded={embedded ? 'true' : 'false'}
      onClick={onClose}
    />
  ),
}))

const renderRoute = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/camper/:camperId/popout" element={<CamperPopout />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('CamperPopout', () => {
  it('renders the embedded CamperDetailsPanel for valid camperId + session param', () => {
    renderRoute('/camper/1001/popout?session=1000001')
    expect(screen.getByTestId('camper-details-panel')).toBeInTheDocument()
    expect(screen.getByTestId('camper-details-panel')).toHaveAttribute('data-camper-id', '1001')
    expect(screen.getByTestId('camper-details-panel')).toHaveAttribute('data-embedded', 'true')
  })

  it('wraps CamperDetailsPanel in a session-scoped BunkRequestProvider', () => {
    renderRoute('/camper/1001/popout?session=1000001')
    const provider = screen.getByTestId('bunk-request-provider')
    expect(provider).toBeInTheDocument()
    expect(provider).toContainElement(screen.getByTestId('camper-details-panel'))
  })

  it('shows an error when ?session param is missing', () => {
    renderRoute('/camper/1001/popout')
    expect(screen.getByText(/session required/i)).toBeInTheDocument()
    expect(screen.queryByTestId('camper-details-panel')).not.toBeInTheDocument()
  })

  it('shows an error when ?session param is non-numeric', () => {
    renderRoute('/camper/1001/popout?session=not-a-number')
    expect(screen.getByText(/invalid session id/i)).toBeInTheDocument()
    expect(screen.queryByTestId('camper-details-panel')).not.toBeInTheDocument()
  })
})
