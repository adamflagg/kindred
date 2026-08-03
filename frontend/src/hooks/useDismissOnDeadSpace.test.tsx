/**
 * The dead-space dismissal shared by the summer board and both weekend
 * surfaces.
 *
 * The behaviour that is easy to lose: the listener attaches one macrotask
 * LATE, so the click that opened a panel is not the click that closes it. With
 * two panels that deferral has to happen again when the second one opens,
 * which is why the hook keys on WHICH panels are open rather than on whether
 * any is.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useDismissOnDeadSpace } from './useDismissOnDeadSpace'

function Harness({ openKey, onDismiss }: { openKey: string | null; onDismiss: () => void }) {
  useDismissOnDeadSpace(openKey, onDismiss)
  return <div data-testid="dead-space">dead space</div>
}

describe('useDismissOnDeadSpace', () => {
  it('dismisses on a click in dead space', async () => {
    const onDismiss = vi.fn()
    render(<Harness openKey="panel-a" onDismiss={onDismiss} />)
    // The listener attaches a macrotask late; let it.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await userEvent.click(screen.getByTestId('dead-space'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not listen while nothing is open', async () => {
    const onDismiss = vi.fn()
    render(<Harness openKey={null} onDismiss={onDismiss} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await userEvent.click(screen.getByTestId('dead-space'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('spares the click that opened the panel', async () => {
    // The whole point of the deferral. Opening and clicking within the same
    // tick must not dismiss.
    const onDismiss = vi.fn()
    function Opener() {
      const [openKey, setOpenKey] = useState<string | null>(null)
      useDismissOnDeadSpace(openKey, onDismiss)
      return (
        <button
          type="button"
          onClick={() => {
            setOpenKey('panel-a')
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

  it('re-arms when a SECOND panel opens, sparing that click too', async () => {
    // Summer's two-panel case, and the one a boolean isOpen would break: the
    // listener is already live for panel A when panel B opens, so without a
    // re-arm the click that opened B would dismiss everything.
    const onDismiss = vi.fn()
    function TwoPanels() {
      const [second, setSecond] = useState(false)
      useDismissOnDeadSpace(`a|${second ? 'b' : ''}`, onDismiss)
      return (
        <button
          type="button"
          onClick={() => {
            setSecond(true)
          }}
        >
          open second
        </button>
      )
    }
    render(<TwoPanels />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await userEvent.click(screen.getByRole('button', { name: 'open second' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('honours shouldKeepPanelsOpen', async () => {
    // A click on the panel itself is not dead space.
    const onDismiss = vi.fn()
    function WithPanel() {
      useDismissOnDeadSpace('panel-a', onDismiss)
      return <div data-panel="camper-details">panel body</div>
    }
    render(<WithPanel />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await userEvent.click(screen.getByText('panel body'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('stops listening once everything closes', async () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<Harness openKey="panel-a" onDismiss={onDismiss} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    rerender(<Harness openKey={null} onDismiss={onDismiss} />)
    await userEvent.click(screen.getByTestId('dead-space'))
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
