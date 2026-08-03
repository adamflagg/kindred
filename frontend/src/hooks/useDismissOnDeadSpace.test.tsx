/**
 * The dead-space dismissal shared by the summer board and both weekend
 * surfaces. Dismisses via `shouldKeepPanelsOpen` on a `click` listener that
 * attaches a macrotask after `isOpen` becomes true, matching summer's
 * original effect byte-for-byte — see the hook's own docstring for why that
 * macrotask is parity-only rather than a mechanism this suite can pin down.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('always dismisses through the latest onDismiss, not the one captured at attach time', async () => {
    // Pins the ref indirection: onDismiss is read through a ref that's
    // updated every render, precisely so a later callback swap while a panel
    // stays open doesn't call a stale closure.
    const fnA = vi.fn()
    const fnB = vi.fn()
    const { rerender } = render(<Harness isOpen onDismiss={fnA} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    rerender(<Harness isOpen onDismiss={fnB} />)
    await userEvent.click(screen.getByTestId('dead-space'))
    expect(fnB).toHaveBeenCalledTimes(1)
    expect(fnA).not.toHaveBeenCalled()
  })

  it('does not tear down and re-arm the listener when onDismiss identity changes while open', async () => {
    // The other half of the ref indirection: onDismiss is intentionally NOT
    // in the main effect's dependency array, so a fresh inline arrow at the
    // call site (BunkingBoardByArea and LodgingBoard both pass one) does not
    // retrigger the deferral. Proven by clicking immediately after a
    // callback-identity-only rerender, with no macrotask wait in between — if
    // the effect had torn down and re-armed, the freshly (re)attached
    // listener would not be live yet and this click would be missed.
    //
    // Uses fireEvent, not userEvent, for that final click: userEvent's click
    // is a multi-step async sequence (mousedown/mouseup/click) that yields
    // the event loop between steps, which is enough real time for even a
    // buggy re-armed listener's setTimeout(0) to fire before the simulated
    // click lands — masking exactly the regression this test exists to
    // catch. fireEvent.click is a single synchronous call with no such gap.
    const onDismiss = vi.fn()
    function ChangingCallback({ isOpen }: { isOpen: boolean }) {
      useDismissOnDeadSpace(isOpen, () => onDismiss())
      return <div data-testid="dead-space">dead space</div>
    }
    const { rerender } = render(<ChangingCallback isOpen />)
    // Let the FIRST render's deferred listener actually attach — this wait is
    // before the part under test, so it cannot mask the mutation.
    await new Promise((resolve) => setTimeout(resolve, 0))
    rerender(<ChangingCallback isOpen />)
    fireEvent.click(screen.getByTestId('dead-space'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
