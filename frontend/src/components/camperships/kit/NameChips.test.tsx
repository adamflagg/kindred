import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AidNameChips, fitChips } from './NameChips'

describe('fitChips', () => {
  it('fits whole chips and keeps room for "+N" while some are left over', () => {
    // three chips of 80px, 4px gap, 34px reserved for "+N": 84 + 84 + 34 = 202 <= 210, a third would need 286
    expect(fitChips([80, 80, 80], 210, 5)).toBe(2)
  })
  it('needs no reserve when every name fits', () => {
    expect(fitChips([80, 80], 168, 2)).toBe(2)
  })
  it('shows none when not even one fits beside "+N" (review focus 5)', () => {
    expect(fitChips([120], 100, 4)).toBe(0)
  })
  it('never fits a later chip after an earlier one failed', () => {
    expect(fitChips([200, 10], 150, 2)).toBe(0)
  })
})

describe('AidNameChips', () => {
  it('renders every chip as a link with its title and days, then the count of the rest', () => {
    render(
      <MemoryRouter>
        <AidNameChips
          total={5}
          chips={[
            {
              key: '1',
              label: 'Garcia',
              days: 12,
              late: true,
              href: '/aid/households/1000002',
              title: 'Open the Garcia household · waiting 12 days',
            },
            {
              key: '2',
              label: 'Chen',
              days: 3,
              href: '/aid/households/1000003',
              title: 'Open the Chen household · waiting 3 days',
            },
          ]}
        />
      </MemoryRouter>
    )
    const garcia = screen.getByRole('link', { name: /Garcia/ })
    expect(garcia).toHaveAttribute('title', 'Open the Garcia household · waiting 12 days')
    expect(garcia).toHaveTextContent('Garcia12d')
    expect(screen.getByTestId('chips-more')).toHaveTextContent('+3') // jsdom measures 0px: every chip fits, 5 − 2 = 3
  })
})

describe('AidNameChips measured layout', () => {
  let resizeCallback: (() => void) | undefined

  beforeEach(() => {
    // 210px room, 80px chips, 4px gap, 34px "+N" reserve: two chips fit (84 + 84 + 34 = 202), a third does not
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(210)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 80,
      height: 22,
      top: 0,
      left: 0,
      right: 80,
      bottom: 22,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    class FakeResizeObserver {
      constructor(cb: () => void) {
        resizeCallback = cb
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resizeCallback = undefined
  })

  it('keeps a chip hidden after a re-measure that leaves the count unchanged', () => {
    const chips = [
      { key: '1', label: 'Garcia', href: '/aid/households/1000002', title: 'Garcia' },
      { key: '2', label: 'Chen', href: '/aid/households/1000003', title: 'Chen' },
      { key: '3', label: 'Okafor', href: '/aid/households/1000004', title: 'Okafor' },
    ]
    const { container } = render(
      <MemoryRouter>
        <AidNameChips total={5} chips={chips} />
      </MemoryRouter>
    )
    const els = () => [...container.querySelectorAll<HTMLElement>('[data-chip]')]
    expect(els()[0]?.style.display).toBe('')
    expect(els()[1]?.style.display).toBe('')
    expect(els()[2]?.style.display).toBe('none')
    expect(screen.getByTestId('chips-more')).toHaveTextContent('+3')

    // the ResizeObserver fires again; the count stays 2, so React does not re-render
    act(() => resizeCallback?.())
    expect(els()[2]?.style.display).toBe('none')
    expect(screen.getByTestId('chips-more')).toHaveTextContent('+3')
  })
})
