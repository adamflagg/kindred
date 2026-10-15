import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useAppChromeHeight } from './useAppChromeHeight'

function Probe() {
  return <span data-testid="h">{useAppChromeHeight()}</span>
}

/** The app's sticky header block (AppLayout's `[data-app-chrome]`, `sticky top-0`) at a given height. */
function chrome(height: number, position = 'sticky') {
  const el = document.createElement('div')
  el.setAttribute('data-app-chrome', '')
  el.style.position = position
  el.getBoundingClientRect = () => ({ height }) as DOMRect
  document.body.prepend(el)
  return el
}

afterEach(() => {
  for (const el of document.querySelectorAll('[data-app-chrome]')) el.remove()
})

describe('useAppChromeHeight: how much of the top of the window the app header covers', () => {
  it('reads the sticky header block’s height, so a sticky bar can sit under it', () => {
    chrome(65)
    render(<Probe />)
    expect(screen.getByTestId('h')).toHaveTextContent('65')
  })

  it('skips a header part that scrolls away (the Season bar, the cache line): only the sticky one covers', () => {
    chrome(40, 'static')
    chrome(93)
    render(<Probe />)
    expect(screen.getByTestId('h')).toHaveTextContent('93')
  })

  it('is 0 where there is no app header (a bare page, a test)', () => {
    render(<Probe />)
    expect(screen.getByTestId('h')).toHaveTextContent('0')
  })

  it('follows the header when it grows: the View as strip opens above the nav', () => {
    let height = 65
    const el = chrome(0)
    el.getBoundingClientRect = () => ({ height }) as DOMRect
    const observers: Array<() => void> = []
    const original = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        observers.push(cb)
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver
    try {
      render(<Probe />)
      expect(screen.getByTestId('h')).toHaveTextContent('65')
      height = 93
      act(() => observers.forEach((cb) => cb()))
      expect(screen.getByTestId('h')).toHaveTextContent('93')
    } finally {
      globalThis.ResizeObserver = original
    }
  })
})
