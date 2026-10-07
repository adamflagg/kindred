import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useBoxWidth } from './programsCostsLayout'

const live = new Set<Element>()
const callbacks = new Map<Element, () => void>()
class FakeObserver {
  private readonly seen = new Set<Element>()
  private readonly cb: () => void
  constructor(cb: () => void) {
    this.cb = cb
  }
  observe(el: Element) {
    this.seen.add(el)
    live.add(el)
    callbacks.set(el, this.cb)
  }
  disconnect() {
    for (const el of this.seen) {
      live.delete(el)
      callbacks.delete(el)
    }
    this.seen.clear()
  }
}

/** The card's shape: a box that unmounts while the editor is open, then comes back. */
function Harness() {
  const [boxRef, width] = useBoxWidth()
  const [editing, setEditing] = useState(false)
  return (
    <section>
      <span data-testid="width">{String(width)}</span>
      <button onClick={() => setEditing((e) => !e)}>toggle</button>
      {editing ? <p>editor</p> : <div data-testid="box" ref={boxRef} />}
    </section>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  live.clear()
  callbacks.clear()
})

describe('useBoxWidth', () => {
  it('follows the box again after it unmounts and returns (Edit…, then Cancel)', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    render(<Harness />)
    act(() => screen.getByText('toggle').click())
    expect(live.size).toBe(0)
    act(() => screen.getByText('toggle').click())
    const box = screen.getByTestId('box')
    expect(live.has(box)).toBe(true) // observed again, not left on the box that unmounted
    Object.defineProperty(box, 'clientWidth', { value: 640, configurable: true })
    act(() => callbacks.get(box)?.())
    expect(screen.getByTestId('width')).toHaveTextContent('640')
  })
})
