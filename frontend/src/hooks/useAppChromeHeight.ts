import { useLayoutEffect, useState } from 'react'

/** AppLayout's sticky header block (the View as strip and the nav). The Season bar and the cache line scroll away. */
function stickyChrome(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-app-chrome]')) {
    if (getComputedStyle(el).position === 'sticky') return el
  }
  return null
}

/**
 * How much of the top of the window the app header covers, in px: a page's own sticky bar sits at this offset, or
 * it slides under the header as the page scrolls (Season › Rules' chapter bar did). It follows the header as it
 * grows or shrinks (the View as strip opens above the nav). 0 where there is no app header.
 */
export function useAppChromeHeight(): number {
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const chrome = stickyChrome()
    if (chrome === null) return undefined
    const read = () => setHeight(Math.round(chrome.getBoundingClientRect().height))
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(read)
    observer.observe(chrome)
    return () => observer.disconnect()
  }, [])
  return height
}
