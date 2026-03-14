import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVelocityControls } from './useVelocityControls'

describe('useVelocityControls', () => {
  const availableYears = [2022, 2023, 2024, 2025, 2026]
  const currentYear = 2026

  it('computes priorYearOptions as years < currentYear, sorted descending', () => {
    const { result } = renderHook(() => useVelocityControls(availableYears, currentYear))
    expect(result.current.priorYearOptions).toEqual([2025, 2024, 2023, 2022])
  })

  it('initializes with empty selectedPriorYears and splitByGender=false', () => {
    const { result } = renderHook(() => useVelocityControls(availableYears, currentYear))
    expect(result.current.selectedPriorYears).toEqual([])
    expect(result.current.splitByGender).toBe(false)
  })

  it('togglePriorYear adds a year when not selected', () => {
    const { result } = renderHook(() => useVelocityControls(availableYears, currentYear))
    act(() => result.current.togglePriorYear(2025))
    expect(result.current.selectedPriorYears).toEqual([2025])
  })

  it('togglePriorYear removes a year when already selected', () => {
    const { result } = renderHook(() => useVelocityControls(availableYears, currentYear))
    act(() => result.current.togglePriorYear(2025))
    act(() => result.current.togglePriorYear(2025))
    expect(result.current.selectedPriorYears).toEqual([])
  })

  it('allows multiple prior years when gender split is off', () => {
    const { result } = renderHook(() => useVelocityControls(availableYears, currentYear))
    act(() => result.current.togglePriorYear(2025))
    act(() => result.current.togglePriorYear(2024))
    expect(result.current.selectedPriorYears).toEqual([2025, 2024])
  })

  it('limits to 1 prior year when gender split is on', () => {
    const { result } = renderHook(() => useVelocityControls(availableYears, currentYear))
    act(() => result.current.handleGenderToggle(true))
    act(() => result.current.togglePriorYear(2025))
    act(() => result.current.togglePriorYear(2024))
    // Second toggle replaces the first (not appends)
    expect(result.current.selectedPriorYears).toEqual([2024])
  })

  it('handleGenderToggle(true) trims prior years to 1 if multiple selected', () => {
    const { result } = renderHook(() => useVelocityControls(availableYears, currentYear))
    act(() => result.current.togglePriorYear(2025))
    act(() => result.current.togglePriorYear(2024))
    expect(result.current.selectedPriorYears).toHaveLength(2)
    act(() => result.current.handleGenderToggle(true))
    expect(result.current.selectedPriorYears).toEqual([2025])
    expect(result.current.splitByGender).toBe(true)
  })

  it('handleGenderToggle(false) does not change selected prior years', () => {
    const { result } = renderHook(() => useVelocityControls(availableYears, currentYear))
    act(() => result.current.togglePriorYear(2025))
    act(() => result.current.handleGenderToggle(true))
    act(() => result.current.handleGenderToggle(false))
    expect(result.current.selectedPriorYears).toEqual([2025])
    expect(result.current.splitByGender).toBe(false)
  })

  it('returns empty priorYearOptions when no years < currentYear', () => {
    const { result } = renderHook(() => useVelocityControls([2026], 2026))
    expect(result.current.priorYearOptions).toEqual([])
  })
})
