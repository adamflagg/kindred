import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router'
import { useGraphFilter } from './useGraphFilter'
import type { ReactNode } from 'react'
import type { BunkSummary } from '../components/graph/graphFilter'

const ALL_BUNKS: BunkSummary[] = [
  { cmId: 1, name: 'B-3' }, // Galil
  { cmId: 2, name: 'G-3' }, // Galil
  { cmId: 5, name: 'B-5' }, // Eilat
  { cmId: 9, name: 'B-9' }, // Chalutzim 1
]

function makeWrapper(initialEntry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {children}
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    )
  }
}

let lastSearch = ''
function LocationProbe() {
  const loc = useLocation()
  lastSearch = loc.search
  return null
}

describe('useGraphFilter', () => {
  it('parses initial URL into FilterState', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?units=galil'),
    })
    expect(result.current.filter.units).toEqual(['Galil'])
    expect(result.current.filter.bunks).toEqual([])
    expect(result.current.isFilterActive).toBe(true)
  })

  it('isFilterActive is false for empty filter', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/'),
    })
    expect(result.current.isFilterActive).toBe(false)
  })

  it('addUnit writes the slug to the URL', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/'),
    })
    act(() => result.current.addUnit('Galil'))
    expect(lastSearch).toContain('units=galil')
  })

  it('addBunk writes the cm_id to the URL', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/'),
    })
    act(() => result.current.addBunk(9))
    expect(lastSearch).toContain('bunks=9')
  })

  it('addBunk is absorbed when its unit is already included', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?units=galil'),
    })
    act(() => result.current.addBunk(1)) // B-3, in Galil
    expect(lastSearch).not.toContain('bunks=')
  })

  it('addUnit removes its bunks from the bunks list', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?bunks=1,9'),
    })
    act(() => result.current.addUnit('Galil'))
    expect(lastSearch).toContain('units=galil')
    expect(lastSearch).toContain('bunks=9') // 1 absorbed, 9 kept
    expect(lastSearch).not.toMatch(/bunks=1\b/)
  })

  it('removeUnit drops the unit', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?units=galil,eilat'),
    })
    act(() => result.current.removeUnit('Galil'))
    expect(lastSearch).toContain('units=eilat')
    expect(lastSearch).not.toContain('galil')
  })

  it('removeBunk drops the bunk', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?bunks=9,17'),
    })
    act(() => result.current.removeBunk(9))
    expect(lastSearch).toContain('bunks=17')
  })

  it('setEdgeMode writes edges=cross', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?units=galil'),
    })
    act(() => result.current.setEdgeMode('cross-scope'))
    expect(lastSearch).toContain('edges=cross')
  })

  it('setEdgeMode strict removes edges param', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?units=galil&edges=cross'),
    })
    act(() => result.current.setEdgeMode('strict'))
    expect(lastSearch).not.toContain('edges=')
  })

  it('clear strips all filter params, preserves others', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?units=galil&bunks=9&edges=cross&year=2026'),
    })
    act(() => result.current.clear())
    expect(lastSearch).not.toContain('units=')
    expect(lastSearch).not.toContain('bunks=')
    expect(lastSearch).not.toContain('edges=')
    expect(lastSearch).toContain('year=2026')
  })
})
