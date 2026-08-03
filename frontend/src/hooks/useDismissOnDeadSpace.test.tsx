/**
 * The dead-space dismissal shared by the summer board and both weekend
 * surfaces.
 *
 * The behaviour that is easy to lose: the listener attaches one macrotask
 * LATE, so the click that opens a panel — going from nothing open to
 * something open — is not the click that closes it. Without that deferral, a
 * listener attached during the same click's bubble would see it and dismiss
 * what the user just opened.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useDismissOnDeadSpace } from './useDismissOnDeadSpace'

function Harness({ isOpen, onDismiss }: { isOpen: boolean; onDismiss: () => void }) {
  useDismissOnDeadSpace(isOpen, onDismiss)
  return <div data-testid="dead-space">dead space</div>
}

describe('useDismissOnDeadSpace', () => {
  it('dismisses on a click in dead space', async () => {
    const onDismiss = vi.fn()
    render(<Harness isOpen onDismiss={onDismiss} />)
    // The listener attaches a macrotask late; let it.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await userEvent.click(screen.getByTestId('dead-space'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not listen while nothing is open', async () => {
    const onDismiss = vi.fn()
    render(<Harness isOpen={false} onDismiss={onDismiss} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await userEvent.click(screen.getByTestId('dead-space'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('spares the click that opened the panel', async () => {
    // The whole point of the deferral. Opening and clicking within the same
    // tick must not dismiss.
    const onDismiss = vi.fn()
    function Opener() {
      const [isOpen, setIsOpen] = useState(false)
      useDismissOnDeadSpace(isOpen, onDismiss)
      return (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true)
          }}
        >
          open
        </button>
      )
    }
    render(<Opener />)
    await userEvent.click(screen.getByRole('button', { name: 'open' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('honours shouldKeepPanelsOpen', async () => {
    // A click on the panel itself is not dead space.
    const onDismiss = vi.fn()
    function WithPanel() {
      useDismissOnDeadSpace(true, onDismiss)
      return <div data-panel="camper-details">panel body</div>
    }
    render(<WithPanel />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await userEvent.click(screen.getByText('panel body'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('stops listening once everything closes', async () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<Harness isOpen onDismiss={onDismiss} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    rerender(<Harness isOpen={false} onDismiss={onDismiss} />)
    await userEvent.click(screen.getByTestId('dead-space'))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
