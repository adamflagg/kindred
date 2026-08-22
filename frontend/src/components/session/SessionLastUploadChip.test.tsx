import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../hooks/session/useLastUploadSummary', () => ({ useLastUploadSummary: vi.fn() }))
vi.mock('./SessionUploadChangesModal', () => ({
  // Exposes isOpen so the always-mounted pin below can see the chip's wiring
  // without rendering the real dialog (which would need a QueryClient).
  default: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="changes-modal" data-open={String(isOpen)} />
  ),
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

  it('mounts the modal closed and drives isOpen from the chip (kindred#2529)', () => {
    // The chip used to gate the dialog with `{open && ...}`, unmounting it in
    // the same frame the close fired — Modal's 150ms exit fade never played.
    // The dialog is now always rendered (once session+runId resolve) and the
    // chip drives its isOpen prop.
    set({
      runId: 'r1',
      finishedAt: 't',
      global: null,
      session: { total: 14, autoMatched: 14, needReview: 0 },
    })
    render(<SessionLastUploadChip sessionCmId={1} agSessionCmIds={[]} sessionName="Session 2" />)

    const stub = screen.getByTestId('changes-modal')
    expect(stub).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: /view last upload changes/i }))
    expect(screen.getByTestId('changes-modal')).toHaveAttribute('data-open', 'true')
  })

  it('does not re-pop the dialog when the upload summary transiently disappears (kindred#2529)', () => {
    // `open` used to survive the `if (!session || !runId) return null` branch,
    // so a transient summary loss (refetch gap, weekend switch) left it true —
    // and when data returned, the always-mounted dialog re-opened itself with
    // no click, via Modal's `appear`. The chip now corrects `open` at render
    // time on that branch.
    const good = {
      runId: 'r1',
      finishedAt: 't',
      global: null,
      session: { total: 14, autoMatched: 14, needReview: 0 },
    }
    set(good)
    const { rerender, container } = render(
      <SessionLastUploadChip sessionCmId={1} agSessionCmIds={[]} sessionName="Session 2" />
    )
    fireEvent.click(screen.getByRole('button', { name: /view last upload changes/i }))
    expect(screen.getByTestId('changes-modal')).toHaveAttribute('data-open', 'true')

    set({ ...good, session: null })
    rerender(<SessionLastUploadChip sessionCmId={1} agSessionCmIds={[]} sessionName="Session 2" />)
    expect(container).toBeEmptyDOMElement()

    set(good)
    rerender(<SessionLastUploadChip sessionCmId={1} agSessionCmIds={[]} sessionName="Session 2" />)
    expect(screen.getByTestId('changes-modal')).toHaveAttribute('data-open', 'false')
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
