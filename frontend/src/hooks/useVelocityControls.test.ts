import { describe, it, expect } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { useVelocityControls } from './useVelocityControls'

const availableYears = [2022, 2023, 2024, 2025, 2026]
const currentYear = 2026

function renderControls(initialEntry: string, years = availableYears, year = currentYear) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [initialEntry] }, children)
  return renderHook(
    () => {
      const controls = useVelocityControls(years, year)
      const location = useLocation()
      return { ...controls, search: location.search }
    },
    { wrapper }
  )
}

/** Starts with no prior year ticked (`priors=` present and empty). */
const NONE = '/?priors='

describe('useVelocityControls', () => {
  it('computes priorYearOptions as years < currentYear, sorted descending', () => {
    const { result } = renderControls(NONE)
    expect(result.current.priorYearOptions).toEqual([2025, 2024, 2023, 2022])
  })

  // Ruling 6 (owner, 2026-10-14): the latest prior year is ticked by default. This test used
  // to read "initializes with empty selectedPriorYears and splitByGender=false".
  it('initializes with the latest prior year ticked and splitByGender=false when priors is absent', () => {
    const { result } = renderControls('/')
    expect(result.current.selectedPriorYears).toEqual([2025])
    expect(result.current.splitByGender).toBe(false)
  })

  // CodeRabbit on #3215: the implicit default must reach the link, or a copied link silently
  // switches comparison year once a newer season exists (Decision 6: "kept in the link").
  it('writes the default latest prior year into the link when priors is absent', () => {
    const { result } = renderControls('/?session=5')
    const params = new URLSearchParams(result.current.search)
    expect(params.get('priors')).toBe('2025')
    expect(params.get('session')).toBe('5')
  })

  it('does not write an empty priors while the year list is still loading', () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: ['/'] }, children)
    const { result, rerender } = renderHook(
      ({ years }: { years: number[] }) => {
        const controls = useVelocityControls(years, currentYear)
        const location = useLocation()
        return { ...controls, search: location.search }
      },
      { wrapper, initialProps: { years: [] as number[] } }
    )
    expect(new URLSearchParams(result.current.search).has('priors')).toBe(false)
    rerender({ years: availableYears })
    expect(new URLSearchParams(result.current.search).get('priors')).toBe('2025')
    expect(result.current.selectedPriorYears).toEqual([2025])
  })

  it('ticks nothing when priors is present and empty', () => {
    const { result } = renderControls(NONE)
    expect(result.current.selectedPriorYears).toEqual([])
  })

  it('reads a comma list from priors, dropping years that are not options', () => {
    const { result } = renderControls('/?priors=2024,2023,1999,2026,abc')
    expect(result.current.selectedPriorYears).toEqual([2024, 2023])
  })

  it('ticks nothing by default when there is no prior year to offer', () => {
    const { result } = renderControls('/', [2026], 2026)
    expect(result.current.selectedPriorYears).toEqual([])
  })

  it('writes the selection to priors and leaves compare= and other params alone', () => {
    const { result } = renderControls('/?compare=2023&session=5')
    act(() => result.current.togglePriorYear(2024))
    const params = new URLSearchParams(result.current.search)
    expect(params.get('priors')).toBe('2025,2024')
    expect(params.get('compare')).toBe('2023')
    expect(params.get('session')).toBe('5')
    expect(result.current.selectedPriorYears).toEqual([2025, 2024])
  })

  it('writes an empty priors when the default year is unticked, so the link keeps "none"', () => {
    const { result } = renderControls('/')
    act(() => result.current.togglePriorYear(2025))
    expect(result.current.selectedPriorYears).toEqual([])
    expect(new URLSearchParams(result.current.search).get('priors')).toBe('')
  })

  it('togglePriorYear adds a year when not selected', () => {
    const { result } = renderControls(NONE)
    act(() => result.current.togglePriorYear(2025))
    expect(result.current.selectedPriorYears).toEqual([2025])
  })

  it('togglePriorYear removes a year when already selected', () => {
    const { result } = renderControls(NONE)
    act(() => result.current.togglePriorYear(2025))
    act(() => result.current.togglePriorYear(2025))
    expect(result.current.selectedPriorYears).toEqual([])
  })

  it('allows multiple prior years when gender split is off', () => {
    const { result } = renderControls(NONE)
    act(() => result.current.togglePriorYear(2025))
    act(() => result.current.togglePriorYear(2024))
    expect(result.current.selectedPriorYears).toEqual([2025, 2024])
  })

  it('limits to 1 prior year when gender split is on', () => {
    const { result } = renderControls(NONE)
    act(() => result.current.handleGenderToggle(true))
    act(() => result.current.togglePriorYear(2025))
    act(() => result.current.togglePriorYear(2024))
    // Second toggle replaces the first (not appends)
    expect(result.current.selectedPriorYears).toEqual([2024])
  })

  it('handleGenderToggle(true) trims prior years to 1 if multiple selected', () => {
    const { result } = renderControls(NONE)
    act(() => result.current.togglePriorYear(2025))
    act(() => result.current.togglePriorYear(2024))
    expect(result.current.selectedPriorYears).toHaveLength(2)
    act(() => result.current.handleGenderToggle(true))
    expect(result.current.selectedPriorYears).toEqual([2025])
    expect(result.current.splitByGender).toBe(true)
    expect(new URLSearchParams(result.current.search).get('priors')).toBe('2025')
  })

  it('handleGenderToggle(false) does not change selected prior years', () => {
    const { result } = renderControls(NONE)
    act(() => result.current.togglePriorYear(2025))
    act(() => result.current.handleGenderToggle(true))
    act(() => result.current.handleGenderToggle(false))
    expect(result.current.selectedPriorYears).toEqual([2025])
    expect(result.current.splitByGender).toBe(false)
  })

  it('returns empty priorYearOptions when no years < currentYear', () => {
    const { result } = renderControls('/', [2026], 2026)
    expect(result.current.priorYearOptions).toEqual([])
  })

  it('keeps the same selectedPriorYears array across renders while the URL is unchanged', () => {
    const { result, rerender } = renderControls('/?priors=2024')
    const first = result.current.selectedPriorYears
    rerender()
    expect(result.current.selectedPriorYears).toBe(first)
  })

  describe('gender basis (#2898 owner answer #78)', () => {
    it('defaults to the Gender field, with nothing in the link', () => {
      const { result } = renderControls(NONE)
      expect(result.current.genderBasis).toBe('field')
      expect(new URLSearchParams(result.current.search).has('gender')).toBe(false)
    })

    it('reads gender=identity from the link', () => {
      const { result } = renderControls('/?priors=&gender=identity')
      expect(result.current.genderBasis).toBe('identity')
    })

    it('writes identity into the link and removes it again for the Gender field', () => {
      const { result } = renderControls('/?priors=2025')
      act(() => result.current.setGenderBasis('identity'))
      expect(result.current.genderBasis).toBe('identity')
      expect(new URLSearchParams(result.current.search).get('gender')).toBe('identity')
      expect(new URLSearchParams(result.current.search).get('priors')).toBe('2025')
      act(() => result.current.setGenderBasis('field'))
      expect(result.current.genderBasis).toBe('field')
      expect(new URLSearchParams(result.current.search).has('gender')).toBe(false)
    })
  })
})
