import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTableSort } from './useTableSort'

describe('useTableSort', () => {
  it('starts in natural order with the lead column showing its arrow', () => {
    const { result } = renderHook(() => useTableSort<'name' | 'enrolled'>('name', ['name']))
    expect(result.current.direction('name')).toBe('ascending')
    expect(result.current.direction('enrolled')).toBeNull()
    const rows = [{ v: 2 }, { v: 1 }]
    expect(result.current.apply(rows, () => 0)).toEqual(rows)
  })

  it('first click: numbers high to low, text A to Z (ruling #60); a second click flips', () => {
    const { result } = renderHook(() => useTableSort<'name' | 'enrolled'>('name', ['name']))
    act(() => result.current.toggle('enrolled'))
    expect(result.current.direction('enrolled')).toBe('descending')
    act(() => result.current.toggle('enrolled'))
    expect(result.current.direction('enrolled')).toBe('ascending')
    act(() => result.current.toggle('name'))
    expect(result.current.direction('name')).toBe('ascending')
    act(() => result.current.toggle('name'))
    expect(result.current.direction('name')).toBe('descending')
  })

  it('never returns to an unsorted third state', () => {
    const { result } = renderHook(() => useTableSort<'name' | 'enrolled'>('name', ['name']))
    for (let i = 0; i < 4; i++) act(() => result.current.toggle('enrolled'))
    expect(result.current.direction('enrolled')).not.toBeNull()
  })
})
