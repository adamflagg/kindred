import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../hooks/session/useLastUploadSummary', () => ({ useLastUploadSummary: vi.fn() }))
vi.mock('./SessionUploadChangesModal', () => ({
  default: () => <div data-testid="changes-modal" />,
}))
import { useLastUploadSummary } from '../../hooks/session/useLastUploadSummary'
import SessionLastUploadChip from './SessionLastUploadChip'

const set = (v: unknown) => (useLastUploadSummary as ReturnType<typeof vi.fn>).mockReturnValue(v)

describe('SessionLastUploadChip', () => {
  it('renders nothing when session slice is null', () => {
    set({
      runId: 'r1',
      finishedAt: 't',
      global: { total: 5, autoMatched: 5, needReview: 0 },
      session: null,
    })
    const { container } = render(
      <SessionLastUploadChip sessionCmId={1} agSessionCmIds={[]} sessionName="Session 2" />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when runId is null', () => {
    set({
      runId: null,
      finishedAt: null,
      global: null,
      session: { total: 3, autoMatched: 3, needReview: 0 },
    })
    const { container } = render(
      <SessionLastUploadChip sessionCmId={1} agSessionCmIds={[]} sessionName="Session 2" />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows count; omits review segment when needReview=0', () => {
    set({
      runId: 'r1',
      finishedAt: 't',
      global: null,
      session: { total: 14, autoMatched: 14, needReview: 0 },
    })
    render(<SessionLastUploadChip sessionCmId={1} agSessionCmIds={[]} sessionName="Session 2" />)
    expect(screen.getByText(/14 new/)).toBeInTheDocument()
    expect(screen.queryByText(/review/i)).not.toBeInTheDocument()
  })

  it('shows review segment when needReview>0', () => {
    set({
      runId: 'r1',
      finishedAt: 't',
      global: null,
      session: { total: 14, autoMatched: 11, needReview: 3 },
    })
    render(<SessionLastUploadChip sessionCmId={1} agSessionCmIds={[]} sessionName="Session 2" />)
    expect(screen.getByText(/3 review/)).toBeInTheDocument()
  })
})
