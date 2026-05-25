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

  it('addBunk writes the lowercased code to the URL', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/'),
    })
    act(() => result.current.addBunk('B-9'))
    expect(lastSearch).toContain('bunks=b-9')
  })

  it('addBunk is absorbed when its unit is already included', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?units=galil'),
    })
    act(() => result.current.addBunk('b-3')) // in Galil
    expect(lastSearch).not.toContain('bunks=')
  })

  it('addUnit removes its bunks from the bunks list', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?bunks=b-3,b-9'),
    })
    act(() => result.current.addUnit('Galil'))
    expect(lastSearch).toContain('units=galil')
    expect(lastSearch).toContain('bunks=b-9') // b-3 absorbed, b-9 kept
    expect(lastSearch).not.toMatch(/bunks=b-3\b/)
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
      wrapper: makeWrapper('/?bunks=b-9,g-10'),
    })
    act(() => result.current.removeBunk('b-9'))
    expect(lastSearch).toContain('bunks=g-10')
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

  it('setBunks([]) clears the gender/bunk selection but PRESERVES edgeMode (Finding 2)', () => {
    // The "All" gender tab must drop the bunk filter WITHOUT resetting the
    // user's cross-scope edge choice. Gender scope and edge mode are independent
    // controls — the tab handler routes through setBunks([]) (not clear()), so
    // edges=cross survives. Previously the "All" branch called clear(), which
    // reset edgeMode back to 'strict' and silently lost the cross-scope view.
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?bunks=b-9&edges=cross'),
    })
    expect(result.current.filter.edgeMode).toBe('cross-scope')

    act(() => result.current.setBunks([]))

    // Bunk selection cleared...
    expect(lastSearch).not.toContain('bunks=')
    expect(lastSearch).not.toContain('units=')
    // ...but the cross-scope edge mode is preserved.
    expect(lastSearch).toContain('edges=cross')
    expect(result.current.filter.edgeMode).toBe('cross-scope')
  })

  it('parses gender from the URL', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?gender=girls'),
    })
    expect(result.current.filter.gender).toBe('girls')
  })

  it('setGender writes gender and clears manual units/bunks', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?units=galil&bunks=b-9'),
    })
    act(() => result.current.setGender('boys'))
    expect(lastSearch).toContain('gender=boys')
    expect(lastSearch).not.toContain('units=')
    expect(lastSearch).not.toContain('bunks=')
  })

  it('setGender("all") removes the gender param', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?gender=ag'),
    })
    act(() => result.current.setGender('all'))
    expect(lastSearch).not.toContain('gender=')
  })

  it('setBunks forces gender back to all (manual mode)', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?gender=girls'),
    })
    act(() => result.current.setBunks(['b-9']))
    expect(lastSearch).not.toContain('gender=')
    expect(lastSearch).toContain('bunks=b-9')
  })

  it('setEdgeMode preserves an active gender', () => {
    const { result } = renderHook(() => useGraphFilter(ALL_BUNKS), {
      wrapper: makeWrapper('/?gender=girls'),
    })
    act(() => result.current.setEdgeMode('cross-scope'))
    expect(lastSearch).toContain('gender=girls')
    expect(lastSearch).toContain('edges=cross')
  })
})
