import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useGlowGroup } from './useGlowGroup'

function Harness() {
  const glow = useGlowGroup<HTMLDivElement>()
  return (
    <div data-testid="group" {...glow}>
      <div data-testid="left" data-glow-card="" />
      <div data-testid="right" data-glow-card="" />
      <div data-testid="plain" />
    </div>
  )
}

function placeAt(el: HTMLElement, left: number, top: number) {
  el.getBoundingClientRect = () =>
    ({ left, top, right: left + 200, bottom: top + 100, width: 200, height: 100 }) as DOMRect
}

// Frames run only when the test says so, so coalescing is observable.
let frames: FrameRequestCallback[] = []
const flushFrames = () => {
  const due = frames
  frames = []
  due.forEach((cb) => cb(0))
}

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames[id - 1] = () => {}
  })
})
afterEach(() => vi.unstubAllGlobals())

function setup() {
  render(<Harness />)
  placeAt(screen.getByTestId('left'), 100, 20)
  placeAt(screen.getByTestId('right'), 400, 20)
  return {
    group: screen.getByTestId('group'),
    left: screen.getByTestId('left'),
    right: screen.getByTestId('right'),
    plain: screen.getByTestId('plain'),
  }
}

describe('useGlowGroup', () => {
  it('gives every card the pointer position relative to itself, not only the hovered one', () => {
    const { group, left, right } = setup()

    fireEvent.pointerMove(group, { clientX: 150, clientY: 40 })
    flushFrames()

    expect(left.style.getPropertyValue('--glow-x')).toBe('50px')
    expect(left.style.getPropertyValue('--glow-y')).toBe('20px')
    // The neighbour's edge lights from the side nearest the pointer.
    expect(right.style.getPropertyValue('--glow-x')).toBe('-250px')
    expect(right.style.getPropertyValue('--glow-y')).toBe('20px')
  })

  it('leaves elements that are not glow cards alone', () => {
    const { group, plain } = setup()

    fireEvent.pointerMove(group, { clientX: 150, clientY: 40 })
    flushFrames()

    expect(plain.style.getPropertyValue('--glow-x')).toBe('')
  })

  it('does no layout work until the next frame, and then only once for a burst of moves', () => {
    const { group, left } = setup()
    const measure = vi.spyOn(left, 'getBoundingClientRect')

    fireEvent.pointerMove(group, { clientX: 110, clientY: 30 })
    fireEvent.pointerMove(group, { clientX: 130, clientY: 30 })
    fireEvent.pointerMove(group, { clientX: 170, clientY: 60 })
    expect(measure).not.toHaveBeenCalled()

    flushFrames()

    expect(measure).toHaveBeenCalledTimes(1)
    expect(left.style.getPropertyValue('--glow-x')).toBe('70px')
    expect(left.style.getPropertyValue('--glow-y')).toBe('40px')
  })

  it('clears the glow when the pointer leaves the group, including a frame still pending', () => {
    const { group, left, right } = setup()

    fireEvent.pointerMove(group, { clientX: 150, clientY: 40 })
    flushFrames()
    fireEvent.pointerMove(group, { clientX: 160, clientY: 40 })
    fireEvent.pointerLeave(group)
    flushFrames()

    expect(left.style.getPropertyValue('--glow-x')).toBe('')
    expect(left.style.getPropertyValue('--glow-y')).toBe('')
    expect(right.style.getPropertyValue('--glow-x')).toBe('')
  })
})
