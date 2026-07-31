/**
 * Aliases are temporal. A wrong year window silently misfiles history into the
 * wrong building — two areas can each have carried the same building name on
 * either side of a rename, so the window is what tells them apart.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../services/lodgingCrud', () => ({
  listLodgingAliases: () =>
    Promise.resolve([
      {
        id: 'a1',
        alias_string: 'North Lodge - Whole',
        member_units: ['u1', 'u2'],
        valid_from_year: 2025,
        valid_to_year: 0,
        source_field: 'Family Camp Cabin',
        notes: '',
        expand: {
          member_units: [
            { id: 'u1', name: 'North Lodge Front', code: 'north-lodge-front' },
            { id: 'u2', name: 'North Lodge Back', code: 'north-lodge-back' },
          ],
        },
      },
      {
        id: 'a2',
        // Deliberately unlike its member unit's name: an alias exists precisely
        // because the source string and the unit name differ.
        alias_string: 'CabinA (legacy label)',
        member_units: ['u3'],
        valid_from_year: 0,
        valid_to_year: 0,
        source_field: '',
        notes: '',
        expand: { member_units: [{ id: 'u3', name: 'Cabin A', code: 'cabin-a' }] },
      },
      {
        id: 'a3',
        alias_string: 'Old Hall',
        member_units: ['u4'],
        valid_from_year: 0,
        valid_to_year: 2024,
        source_field: '',
        notes: '',
        expand: { member_units: [{ id: 'u4', name: 'Old Hall', code: 'old-hall' }] },
      },
    ]),
  listLodgingUnits: () => Promise.resolve([]),
  createLodgingAlias: vi.fn(),
  updateLodgingAlias: vi.fn(),
  deleteLodgingAlias: vi.fn(),
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

import { LodgingAliasesPanel } from './LodgingAliasesPanel'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('LodgingAliasesPanel', () => {
  it('labels a multi-member alias as a merge', async () => {
    render(<LodgingAliasesPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('North Lodge - Whole')).toBeInTheDocument()
    })
    expect(screen.getByText('Merge of 2 units')).toBeInTheDocument()
  })

  it('shows a single-member alias as an atomic room', async () => {
    render(<LodgingAliasesPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('CabinA (legacy label)')).toBeInTheDocument()
    })
    // Two of the three fixtures map to exactly one unit.
    expect(screen.getAllByText('Single unit')).toHaveLength(2)
  })

  it('renders an open-ended year window as "2025 onwards", not "2025–0"', async () => {
    render(<LodgingAliasesPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('2025 onwards')).toBeInTheDocument()
    })
    expect(screen.queryByText('2025–0')).not.toBeInTheDocument()
  })

  it('renders an unbounded window as "All years"', async () => {
    render(<LodgingAliasesPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('All years')).toBeInTheDocument()
    })
  })

  it('renders a close-ended window as "Up to 2024", never "0–2024"', async () => {
    render(<LodgingAliasesPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('Up to 2024')).toBeInTheDocument()
    })
    expect(screen.queryByText('0–2024')).not.toBeInTheDocument()
  })
})
