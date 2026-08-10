/**
 * The accessible-tooltip primitive (kindred#2177).
 *
 * These tests are the specification for the four reaches a bare `title`
 * attribute does not have: keyboard focus, touch, Escape, and the pointer
 * travelling onto the bubble to read it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Tooltip } from './Tooltip'

afterEach(() => {
  vi.useRealTimers()
})

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /answers disagree/i })
}

function renderChip(props: Partial<React.ComponentProps<typeof Tooltip>> = {}) {
  return render(
    <Tooltip content="The registration form and the Family Camp form disagree." {...props}>
      Answers disagree
    </Tooltip>
  )
}

describe('Tooltip — the trigger', () => {
  it('is a real button, so it is in the tab order', () => {
    renderChip()
    const button = trigger()
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('is DESCRIBED by the bubble text even before anything is shown', () => {
    // The `title` attribute this replaces was the whole gap: unreliable for
    // screen readers, invisible to touch. The description has to resolve at
    // all times, not only once the bubble is on screen, or a reader that
    // computes it at focus time races the state update.
    renderChip()
    expect(trigger()).toHaveAccessibleDescription(
      'The registration form and the Family Camp form disagree.'
    )
  })

  it('carries the focus ring the weekend roster row uses', () => {
    renderChip()
    expect(trigger()).toHaveClass('focus-visible:ring-ring')
    expect(trigger()).toHaveClass('focus-visible:ring-2')
  })

  it('guarantees a 24px tap target without drawing anything', () => {
    // WCAG 2.5.8. A transparent pseudo-element, NOT a visible box: a dashed
    // outline would collide with the empty-room dashed border already in
    // `LodgingUnitCard`'s vocabulary.
    renderChip()
    const button = trigger()
    expect(button.className).toContain("after:content-['']")
    expect(button.className).toContain('after:h-[max(100%,24px)]')
    expect(button.className).toContain('after:w-[max(100%,24px)]')
  })

  it('keeps the caller`s classes and test id on the trigger', () => {
    renderChip({ className: 'bg-red-100', 'data-testid': 'conflict-chip' })
    const button = screen.getByTestId('conflict-chip')
    expect(button).toHaveClass('bg-red-100')
  })

  it('shows no bubble until something asks for one', () => {
    renderChip()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('Tooltip — hover', () => {
  /**
   * `fireEvent.pointerOut`, not `fireEvent.pointerLeave`: React synthesises
   * `onPointerLeave` from the native `pointerout`/`pointerover` pair, and only
   * that path carries a real `relatedTarget`. A directly dispatched
   * `pointerleave` reaches the handler but arrives with `relatedTarget` set to
   * the window, which silently makes every "did the pointer move onto the
   * bubble" assertion vacuous.
   */
  it('opens on pointer enter and closes on pointer leave', () => {
    renderChip()
    fireEvent.pointerEnter(trigger())
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'The registration form and the Family Camp form disagree.'
    )
    fireEvent.pointerOut(trigger(), { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('stays readable while the pointer travels onto the bubble (WCAG 1.4.13)', () => {
    renderChip()
    fireEvent.pointerEnter(trigger())
    const bubble = screen.getByRole('tooltip')
    fireEvent.pointerOut(trigger(), { relatedTarget: bubble })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerEnter(bubble)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerOut(bubble, { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('a pointer returning from the bubble to the trigger does not close it', () => {
    renderChip()
    fireEvent.pointerEnter(trigger())
    const bubble = screen.getByRole('tooltip')
    fireEvent.pointerEnter(bubble)
    fireEvent.pointerOut(bubble, { relatedTarget: trigger() })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })
})

describe('Tooltip — keyboard', () => {
  it('opens on focus and closes on blur', () => {
    renderChip()
    fireEvent.focus(trigger())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.blur(trigger())
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('Escape dismisses the bubble while focus stays on the trigger', () => {
    renderChip()
    fireEvent.focus(trigger())
    fireEvent.keyDown(trigger(), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('re-opens after Escape once the trigger is interacted with again', () => {
    renderChip()
    fireEvent.focus(trigger())
    fireEvent.keyDown(trigger(), { key: 'Escape' })
    fireEvent.pointerEnter(trigger())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })
})

describe('Tooltip — touch', () => {
  it('a tap opens the bubble and it STAYS open — no auto-dismiss timer', () => {
    // Ruled 2026-08-09: WCAG 1.4.13 requires hover/focus content to be
    // persistent. A timed dismissal would fail it while looking finished.
    vi.useFakeTimers()
    renderChip()
    fireEvent.click(trigger())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('a second tap on the trigger closes it', () => {
    renderChip()
    fireEvent.click(trigger())
    fireEvent.click(trigger())
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('a tap elsewhere closes it', () => {
    renderChip()
    fireEvent.click(trigger())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('survives a pointer leave once it has been pinned by a tap', () => {
    renderChip()
    fireEvent.pointerEnter(trigger())
    fireEvent.click(trigger())
    fireEvent.pointerOut(trigger(), { relatedTarget: document.body })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })
})

describe('Tooltip — a trigger that already has its own action', () => {
  it('runs the action on click instead of pinning', () => {
    const onActivate = vi.fn()
    renderChip({ onActivate })
    fireEvent.click(trigger())
    expect(onActivate).toHaveBeenCalledTimes(1)
    // Not pinned: leaving with the pointer closes it like any hover tooltip.
    fireEvent.pointerEnter(trigger())
    fireEvent.pointerOut(trigger(), { relatedTarget: document.body })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})

describe('Tooltip — Escape does not reach the host', () => {
  /**
   * The live coordination problem `ui/modalStack` exists for, solved the other
   * way round: this tooltip deliberately does NOT listen on `document`, so its
   * Escape handler can stop the event by propagation before a host that does
   * (`weekend/FamilyDetailsPanel`, `ui/Modal`) ever sees it.
   */
  function Host({ onEscape }: { onEscape: () => void }) {
    useEffect(() => {
      const handler = (event: KeyboardEvent) => {
        if (event.key === 'Escape') onEscape()
      }
      document.addEventListener('keydown', handler)
      return () => {
        document.removeEventListener('keydown', handler)
      }
    }, [onEscape])
    return (
      <Tooltip content="The registration form and the Family Camp form disagree.">
        Answers disagree
      </Tooltip>
    )
  }

  it('closes only the tooltip when the bubble is showing', () => {
    const onEscape = vi.fn()
    render(<Host onEscape={onEscape} />)
    fireEvent.click(trigger())
    fireEvent.keyDown(trigger(), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('lets Escape through to the host when no bubble is showing', () => {
    const onEscape = vi.fn()
    render(<Host onEscape={onEscape} />)
    fireEvent.keyDown(trigger(), { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })
})
