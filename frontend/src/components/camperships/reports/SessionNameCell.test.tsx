/**
 * A session's name on Statistics › Session (approved final mock reports-statistics.html; owner 10-09,
 * "short but not tiny vs full length"): the FULL name when it fits its column on one line, else the SHORT
 * form (never tiny), the full name always the title. A short form that still cannot fit cuts with an
 * ellipsis. Family Camp rows carry a house mark and say each app is a household.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SessionNameCell } from './SessionNameCell'

let room = 1000
let observed: (() => void) | null = null
let watched: Element[] = []
const original = {
  scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth'),
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
  observer: globalThis.ResizeObserver,
}

beforeEach(() => {
  // jsdom lays nothing out: a name is 7px a character, the column is `room` wide
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent.length * 7
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return room
    },
  })
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      observed = callback
    }
    observe(element: Element) {
      watched.push(element)
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterEach(() => {
  room = 1000
  observed = null
  watched = []
  for (const key of ['scrollWidth', 'clientWidth'] as const) {
    if (original[key]) Object.defineProperty(HTMLElement.prototype, key, original[key])
  }
  globalThis.ResizeObserver = original.observer
})

const FULL = 'All-Gender Cabin-Session 2 (7th & 8th grades)'

describe('SessionNameCell', () => {
  it('shows the full name when it fits the column on one line', () => {
    render(<SessionNameCell name={FULL} sessionType="ag" />)
    expect(screen.getByText(FULL)).toBeInTheDocument()
  })

  it('swaps to the short form when the full name does not fit, and keeps the full name as the title', () => {
    room = 200
    render(<SessionNameCell name={FULL} sessionType="ag" />)
    expect(screen.getByText('AG 2 (7-8)')).toBeInTheDocument()
    expect(screen.queryByText(FULL)).toBeNull()
    expect(screen.getByText('AG 2 (7-8)').closest('span[title]')).toHaveAttribute('title', FULL)
  })

  it('cuts a short form that still cannot fit with an ellipsis', () => {
    room = 20
    render(<SessionNameCell name={FULL} sessionType="ag" />)
    expect(screen.getByText('AG 2 (7-8)')).toHaveClass('truncate')
  })

  it('returns to the full name when the column grows, and swaps again when it shrinks', () => {
    room = 200
    render(<SessionNameCell name={FULL} sessionType="ag" />)
    expect(screen.getByText('AG 2 (7-8)')).toBeInTheDocument()
    room = 1000
    act(() => observed?.())
    expect(screen.getByText(FULL)).toBeInTheDocument()
    room = 200
    act(() => observed?.())
    expect(screen.getByText('AG 2 (7-8)')).toBeInTheDocument()
  })

  it('watches the cell, not the name: a short name keeps its own width while the column grows', () => {
    room = 200
    render(<SessionNameCell name={FULL} sessionType="ag" />)
    expect(watched).toEqual([screen.getByText('AG 2 (7-8)').closest('span[title]')])
  })

  it('marks a Family Camp session with a house and says each app is a household; its short form has no subtitle', () => {
    room = 200
    const full = 'Family Camp 3: Young Families Weekend (w/ kids 10 and under)'
    render(<SessionNameCell name={full} sessionType="family" />)
    expect(screen.getByText('Family Camp 3')).toBeInTheDocument()
    const cell = screen.getByText('Family Camp 3').closest('span[title]') as HTMLElement
    expect(cell).toHaveAttribute('title', `${full} · household requests: each app is a household`)
    expect(cell.querySelector('svg')).not.toBeNull()
  })

  it('draws no house for a session that is not Family Camp', () => {
    const { container } = render(<SessionNameCell name="Session 2" sessionType="main" />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('shows a name with no type as it is when it fits', () => {
    render(<SessionNameCell name="Session not matched" sessionType="" />)
    expect(screen.getByText('Session not matched')).toBeInTheDocument()
  })
})
