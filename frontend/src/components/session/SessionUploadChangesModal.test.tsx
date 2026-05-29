import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'

const auth = vi.hoisted(() => ({ isAuthLoading: false }))
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthLoading: auth.isAuthLoading }),
}))
vi.mock('../../services/sessionUploadChanges', () => ({ fetchSessionUploadChanges: vi.fn() }))
import { fetchSessionUploadChanges } from '../../services/sessionUploadChanges'
import SessionUploadChangesModal from './SessionUploadChangesModal'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)
const mock = (rows: unknown) =>
  (fetchSessionUploadChanges as ReturnType<typeof vi.fn>).mockResolvedValue(rows)

beforeEach(() => {
  vi.clearAllMocks()
  auth.isAuthLoading = false
})

describe('SessionUploadChangesModal', () => {
  it('does not fetch while auth is still loading (frontend/CLAUDE.md auth gate)', async () => {
    auth.isAuthLoading = true
    mock([])
    render(
      <SessionUploadChangesModal
        runId="r1"
        sessionCmIds={[1000001]}
        sessionName="Session 2"
        onClose={() => {}}
      />,
      { wrapper }
    )
    await Promise.resolve()
    expect(fetchSessionUploadChanges).not.toHaveBeenCalled()
  })

  it('groups by camper and sorts needs-review first', async () => {
    // debug_pipeline_summary.final_status is stored UPPERCASE by convention
    // (orchestrator.py: raw_status.upper()), so fixtures must match production.
    mock([
      {
        requester_cm_id: 1,
        requester_name: 'Emma Johnson',
        target_name: 'Olivia Chen',
        request_type: 'bunk_with',
        final_status: 'RESOLVED',
        session_cm_id: 1,
      },
      {
        requester_cm_id: 2,
        requester_name: 'Noah Smith',
        target_name: 'Ethan',
        request_type: 'not_bunk_with',
        final_status: 'PENDING',
        session_cm_id: 1,
      },
    ])
    render(
      <SessionUploadChangesModal
        runId="r1"
        sessionCmIds={[1]}
        sessionName="Session 2"
        onClose={() => {}}
      />,
      { wrapper }
    )
    const names = await screen.findAllByTestId('camper-group-name')
    expect(names[0]).toHaveTextContent('Noah Smith') // pending sorted first
    expect(screen.getByText(/needs review/i)).toBeInTheDocument()
    expect(screen.getByText(/auto-matched/i)).toBeInTheDocument()
  })

  it('shows empty state when no rows', async () => {
    mock([])
    render(
      <SessionUploadChangesModal
        runId="r1"
        sessionCmIds={[1]}
        sessionName="Session 2"
        onClose={() => {}}
      />,
      { wrapper }
    )
    expect(await screen.findByText(/no new requests/i)).toBeInTheDocument()
  })
})
