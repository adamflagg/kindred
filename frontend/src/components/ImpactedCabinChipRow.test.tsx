/**
 * Tests for ImpactedCabinChipRow component.
 *
 * Covers:
 * 1. Renders distinct cabin chips in alphabetical order with "(N)" count
 * 2. Click chip triggers scrollIntoView on matching cabin section elements
 * 3. Active-state chip reflects which cabin is currently in viewport
 *    (via mocked IntersectionObserver)
 * 4. No crash when moved list is empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ImpactedCabinChipRow, { type ImpactedCabinChipRowProps } from './ImpactedCabinChipRow'

// ---------------------------------------------------------------------------
// Shared test data helpers
// ---------------------------------------------------------------------------

function makeChips(names: string[]) {
  return names.map((name, i) => ({ name, count: i + 1 }))
}

// ---------------------------------------------------------------------------
// Mock scrollIntoView — jsdom does not implement it.
// We attach per-instance mocks rather than a shared prototype mock so tests
// can independently assert which element was scrolled.
// ---------------------------------------------------------------------------

function attachScrollMock(el: HTMLElement) {
  el.scrollIntoView = vi.fn()
  return el
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Mock IntersectionObserver
// ---------------------------------------------------------------------------

type IOCallback = (entries: IntersectionObserverEntry[]) => void
let ioCallback: IOCallback | null = null
const ioObservedTargets: Element[] = []

function makeMockIO(cb: IOCallback) {
  ioCallback = cb
  return {
    observe: (el: Element) => {
      ioObservedTargets.push(el)
    },
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as IntersectionObserver
}

beforeEach(() => {
  ioObservedTargets.length = 0
  ioCallback = null
  vi.stubGlobal('IntersectionObserver', vi.fn().mockImplementation(makeMockIO))
})

// ---------------------------------------------------------------------------
// Helper to build minimal props
// ---------------------------------------------------------------------------

function buildProps(overrides?: Partial<ImpactedCabinChipRowProps>): ImpactedCabinChipRowProps {
  return {
    chips: makeChips(['Maple', 'Olive']),
    getCabinSectionElements: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImpactedCabinChipRow', () => {
  describe('rendering', () => {
    it('renders one chip per cabin with name and count label', () => {
      render(
        <ImpactedCabinChipRow
          {...buildProps({
            chips: [
              { name: 'Maple', count: 3 },
              { name: 'Olive', count: 2 },
            ],
          })}
        />
      )

      expect(screen.getByText('Maple (3)')).toBeInTheDocument()
      expect(screen.getByText('Olive (2)')).toBeInTheDocument()
    })

    it('renders chips in alphabetical order regardless of prop order', () => {
      render(
        <ImpactedCabinChipRow
          {...buildProps({
            chips: [
              { name: 'Spruce', count: 1 },
              { name: 'Alder', count: 2 },
              { name: 'Maple', count: 3 },
            ],
          })}
        />
      )

      const chipEls = screen.getAllByRole('button')
      const names = chipEls.map((el) => el.textContent?.split(' (')[0])
      // Should be alphabetically sorted
      expect(names).toEqual(['Alder', 'Maple', 'Spruce'])
    })

    it('renders nothing (no buttons) when chip list is empty', () => {
      render(<ImpactedCabinChipRow {...buildProps({ chips: [] })} />)
      expect(screen.queryAllByRole('button')).toHaveLength(0)
    })

    it('does not crash when chips list is empty (regression: no Moved rows)', () => {
      expect(() => render(<ImpactedCabinChipRow {...buildProps({ chips: [] })} />)).not.toThrow()
    })
  })

  describe('click → scroll', () => {
    it('calls scrollIntoView on the matching cabin section element when chip is clicked', () => {
      // Build two fake DOM elements with per-instance scroll mocks
      const oliveEl = attachScrollMock(document.createElement('div'))
      oliveEl.setAttribute('data-cabin', 'Olive')

      const mapleEl = attachScrollMock(document.createElement('div'))
      mapleEl.setAttribute('data-cabin', 'Maple')

      const getCabinSectionElements = vi.fn().mockReturnValue([oliveEl, mapleEl])

      render(
        <ImpactedCabinChipRow
          {...buildProps({
            chips: [
              { name: 'Maple', count: 1 },
              { name: 'Olive', count: 2 },
            ],
            getCabinSectionElements,
          })}
        />
      )

      fireEvent.click(screen.getByText('Olive (2)'))

      expect(oliveEl.scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth' })
      )
      // Maple should NOT have been scrolled
      expect(mapleEl.scrollIntoView).not.toHaveBeenCalled()
    })

    it('re-scrolls to the same cabin when the same chip is clicked again', () => {
      const oliveEl = attachScrollMock(document.createElement('div'))
      oliveEl.setAttribute('data-cabin', 'Olive')

      const getCabinSectionElements = vi.fn().mockReturnValue([oliveEl])

      render(
        <ImpactedCabinChipRow
          {...buildProps({
            chips: [{ name: 'Olive', count: 1 }],
            getCabinSectionElements,
          })}
        />
      )

      fireEvent.click(screen.getByText('Olive (1)'))
      fireEvent.click(screen.getByText('Olive (1)'))

      expect(oliveEl.scrollIntoView).toHaveBeenCalledTimes(2)
    })

    it('does nothing when no matching section element is found', () => {
      const getCabinSectionElements = vi.fn().mockReturnValue([])

      render(
        <ImpactedCabinChipRow
          {...buildProps({
            chips: [{ name: 'Olive', count: 1 }],
            getCabinSectionElements,
          })}
        />
      )

      // Should not throw even if element is not found
      expect(() => fireEvent.click(screen.getByText('Olive (1)'))).not.toThrow()
    })
  })

  describe('active-state chip via IntersectionObserver', () => {
    it('marks a chip as active when its cabin section enters the viewport', () => {
      const oliveEl = document.createElement('div')
      oliveEl.setAttribute('data-cabin', 'Olive')

      const getCabinSectionElements = vi.fn().mockReturnValue([oliveEl])

      render(
        <ImpactedCabinChipRow
          {...buildProps({
            chips: [
              { name: 'Olive', count: 2 },
              { name: 'Maple', count: 1 },
            ],
            getCabinSectionElements,
          })}
        />
      )

      // Simulate Olive section entering the viewport
      act(() => {
        ioCallback?.([
          {
            target: oliveEl,
            isIntersecting: true,
          } as unknown as IntersectionObserverEntry,
        ])
      })

      // The Olive chip should now have an active visual indicator
      // We check for aria-pressed=true or a data-active attribute on the button
      const oliveChip = screen.getByText('Olive (2)').closest('button')
      expect(oliveChip).toHaveAttribute('aria-pressed', 'true')
    })

    it('deactivates a chip when its section leaves the viewport', () => {
      const oliveEl = document.createElement('div')
      oliveEl.setAttribute('data-cabin', 'Olive')

      const getCabinSectionElements = vi.fn().mockReturnValue([oliveEl])

      render(
        <ImpactedCabinChipRow
          {...buildProps({
            chips: [{ name: 'Olive', count: 1 }],
            getCabinSectionElements,
          })}
        />
      )

      // Enter
      act(() => {
        ioCallback?.([
          { target: oliveEl, isIntersecting: true } as unknown as IntersectionObserverEntry,
        ])
      })

      // Leave
      act(() => {
        ioCallback?.([
          { target: oliveEl, isIntersecting: false } as unknown as IntersectionObserverEntry,
        ])
      })

      const oliveChip = screen.getByText('Olive (1)').closest('button')
      expect(oliveChip).toHaveAttribute('aria-pressed', 'false')
    })

    it('only the intersecting chip is active when multiple cabins are observed', () => {
      const oliveEl = document.createElement('div')
      oliveEl.setAttribute('data-cabin', 'Olive')
      const mapleEl = document.createElement('div')
      mapleEl.setAttribute('data-cabin', 'Maple')

      const getCabinSectionElements = vi.fn().mockReturnValue([oliveEl, mapleEl])

      render(
        <ImpactedCabinChipRow
          {...buildProps({
            chips: [
              { name: 'Olive', count: 2 },
              { name: 'Maple', count: 1 },
            ],
            getCabinSectionElements,
          })}
        />
      )

      // Only Olive enters
      act(() => {
        ioCallback?.([
          { target: oliveEl, isIntersecting: true } as unknown as IntersectionObserverEntry,
          { target: mapleEl, isIntersecting: false } as unknown as IntersectionObserverEntry,
        ])
      })

      const oliveChip = screen.getByText('Olive (2)').closest('button')
      const mapleChip = screen.getByText('Maple (1)').closest('button')
      expect(oliveChip).toHaveAttribute('aria-pressed', 'true')
      expect(mapleChip).toHaveAttribute('aria-pressed', 'false')
    })
  })
})
