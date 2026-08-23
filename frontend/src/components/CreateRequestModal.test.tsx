/**
 * kindred#2538 tier 2b. CreateRequestModal is always mounted so ui/Modal's
 * 150ms leave can play, which costs it the free state wipe an unmount used to
 * give it, and makes its camper fetch run whether or not the dialog is open.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CreateRequestModal from './CreateRequestModal'

const getFullList = vi.fn(() => Promise.resolve([]))

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({
      getFullList: (...args: unknown[]) => getFullList(...(args as [])),
      create: vi.fn(() => Promise.resolve({})),
    })),
    authStore: { isValid: true, model: { id: 'test-user' }, onChange: vi.fn() },
  },
}))

vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function renderModal(props: { isOpen?: boolean; nonce?: number } = {}) {
  return render(
    <CreateRequestModal sessionId={1000001} year={2026} onClose={vi.fn()} {...props} />,
    { wrapper: Wrapper }
  )
}

describe('CreateRequestModal — always-mounted conversion (kindred#2538)', () => {
  beforeEach(() => {
    getFullList.mockClear()
  })

  it('stays painted on the close frame, then unmounts once the leave completes', async () => {
    const { rerender } = renderModal({ isOpen: true })
    // The heading, not `getByText` — the footer's submit button carries the
    // same words, so a bare text query matches two nodes.
    expect(screen.getByRole('heading', { name: 'Create Request' })).toBeInTheDocument()

    rerender(
      <CreateRequestModal sessionId={1000001} year={2026} onClose={vi.fn()} isOpen={false} />
    )

    // Still painted on the close frame — this is the exit fade having
    // something to fade.
    expect(screen.getByRole('heading', { name: 'Create Request' })).toBeInTheDocument()

    // ...and GONE once the leave finishes. Both halves are required: the
    // presence assertion alone passes vacuously against the unconverted
    // component, which hardcodes `isOpen={true}` and so ignores the prop
    // entirely and never unmounts at all.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Create Request' })).not.toBeInTheDocument()
    )
  })

  it('does not fetch the session campers while it is closed', async () => {
    renderModal({ isOpen: false })

    // The list of every enrolled attendee is the dialog's only fetch, and a
    // closed dialog has nobody to show it to. Before the gate this fired on
    // every RequestReviewPanel visit whether the dialog opened or not.
    await Promise.resolve()
    expect(getFullList).not.toHaveBeenCalled()
  })

  it('fetches the session campers once it is opened', async () => {
    const { rerender } = renderModal({ isOpen: false })
    expect(getFullList).not.toHaveBeenCalled()

    rerender(<CreateRequestModal sessionId={1000001} year={2026} onClose={vi.fn()} isOpen={true} />)

    // The gate must be `isOpen`, not a permanent `false` — opening still loads.
    await vi.waitFor(() => expect(getFullList).toHaveBeenCalled())
  })

  it('reopening clears the notes rather than showing the abandoned draft', async () => {
    const user = userEvent.setup()
    const { rerender } = renderModal({ isOpen: true, nonce: 1 })

    const notes = await screen.findByLabelText(/Notes/i)
    await user.type(notes, 'draft that must not survive')
    expect(screen.getByLabelText(/Notes/i)).toHaveValue('draft that must not survive')

    // Close and reopen with no `await` between the two rerenders, so the leave
    // is still in flight — the case a nonce exists for (kindred#2553 for why
    // this must not be awaited userEvent).
    rerender(
      <CreateRequestModal
        sessionId={1000001}
        year={2026}
        onClose={vi.fn()}
        isOpen={false}
        nonce={1}
      />
    )
    rerender(
      <CreateRequestModal
        sessionId={1000001}
        year={2026}
        onClose={vi.fn()}
        isOpen={true}
        nonce={2}
      />
    )

    expect(await screen.findByLabelText(/Notes/i)).toHaveValue('')
  })

  it('reopening clears the requester search rather than showing the abandoned one', async () => {
    const user = userEvent.setup()
    const { rerender } = renderModal({ isOpen: true, nonce: 1 })

    const search = await screen.findByLabelText(/Requester/i)
    await user.type(search, 'Rivera')
    expect(screen.getByLabelText(/Requester/i)).toHaveValue('Rivera')

    rerender(
      <CreateRequestModal
        sessionId={1000001}
        year={2026}
        onClose={vi.fn()}
        isOpen={false}
        nonce={1}
      />
    )
    rerender(
      <CreateRequestModal
        sessionId={1000001}
        year={2026}
        onClose={vi.fn()}
        isOpen={true}
        nonce={2}
      />
    )

    expect(await screen.findByLabelText(/Requester/i)).toHaveValue('')
  })

  it('reopening restores the default request type rather than the previously chosen one', async () => {
    const user = userEvent.setup()
    const { rerender } = renderModal({ isOpen: true, nonce: 1 })

    await user.selectOptions(await screen.findByLabelText(/Request Type/i), 'not_bunk_with')
    expect(screen.getByLabelText(/Request Type/i)).toHaveValue('not_bunk_with')

    rerender(
      <CreateRequestModal
        sessionId={1000001}
        year={2026}
        onClose={vi.fn()}
        isOpen={false}
        nonce={1}
      />
    )
    rerender(
      <CreateRequestModal
        sessionId={1000001}
        year={2026}
        onClose={vi.fn()}
        isOpen={true}
        nonce={2}
      />
    )

    expect(await screen.findByLabelText(/Request Type/i)).toHaveValue('bunk_with')
  })
})
