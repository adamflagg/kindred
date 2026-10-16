/**
 * Drill-downs read gender identity (#2898, owner #80): the modal keeps ONE Gender column, showing the identity
 * label as staff read it; a camper with no identity answer, counted by the Gender field (ruling 58), has the
 * Gender note's number on their cell and a visible line under the list says how many. The CSV carries BOTH a
 * "Gender identity" and a "Gender field" column. The modal's columns stay fixed.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DrillDownModal } from './DrillDownModal'
import type { DrilldownAttendee, DrilldownFilter } from '../../types/metrics'

let mockAttendees: DrilldownAttendee[] = []

vi.mock('../../hooks/useDrilldownAttendees', () => ({
  useDrilldownAttendees: () => ({ data: mockAttendees, isLoading: false, error: null }),
}))

const mockTriggerCsvDownload = vi.fn()
vi.mock('../../utils/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/csvExport')>()),
  downloadCsv: (...args: unknown[]) => mockTriggerCsvDownload(...args) as unknown,
}))

vi.mock('react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode
    to: string
    [k: string]: unknown
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

function renderModal(filter: DrilldownFilter) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DrillDownModal year={2026} filter={filter} onClose={vi.fn()} />
    </QueryClientProvider>
  )
}

const ENROLLED: DrilldownFilter = { type: 'gender', value: 'Girl/woman', label: 'Girl/woman' }

function camper(overrides: Partial<DrilldownAttendee>): DrilldownAttendee {
  return {
    person_id: 1000001,
    first_name: 'Emma',
    last_name: 'Johnson',
    grade: 6,
    gender: 'Girl/woman',
    gender_field: 'F',
    gender_counted_by_field: false,
    session_name: 'Session 2',
    session_cm_id: 1001,
    status: 'enrolled',
    is_returning: false,
    ...overrides,
  }
}

function lastCsv(): string[] {
  const [csv] = mockTriggerCsvDownload.mock.calls.at(-1) as [string, string]
  return csv.trim().split(/\r?\n/)
}

function genderCell(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr') as HTMLElement
  return within(row).getAllByRole('cell')[2] as HTMLElement
}

describe('DrillDownModal — gender identity (#80)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAttendees = [
      camper({}),
      camper({
        person_id: 1000002,
        first_name: 'Olivia',
        last_name: 'Chen',
        gender_counted_by_field: true,
      }),
      camper({
        person_id: 1000003,
        first_name: 'Riley',
        last_name: 'Sam',
        gender: 'not given',
        gender_field: null,
      }),
    ]
  })

  it('shows the identity label, capitalised as staff read it', () => {
    renderModal(ENROLLED)
    expect(genderCell('Emma Johnson').textContent).toBe('Girl/woman')
    expect(genderCell('Riley Sam').textContent).toBe('Not given')
  })

  it('marks a camper counted by the Gender field with the Gender note number', () => {
    renderModal(ENROLLED)
    const n = genderCell('Olivia Chen').querySelector('sup')?.textContent
    expect(n).toMatch(/^\d+$/)
    expect(genderCell('Emma Johnson').querySelector('sup')).toBeNull()
    expect(screen.getByText(/with no gender identity answer is counted/).textContent).toBe(
      `${n} 1 camper with no gender identity answer is counted by the Gender field.`
    )
    const note = screen.getByText(/gender identity from CampMinder/).closest('li') as HTMLElement
    expect(note.textContent).toMatch(new RegExp(`^${n}\\.`))
    expect(note.textContent).toContain(`their Gender cell is marked ${n}`)
  })

  it('has no mark, line or Gender note when no camper fell back', () => {
    mockAttendees = [camper({})]
    renderModal(ENROLLED)
    expect(screen.queryByText(/counted by the Gender field/)).toBeNull()
    expect(screen.queryByText(/gender identity from CampMinder/)).toBeNull()
  })

  it('writes both a Gender identity and a Gender field column to the CSV', () => {
    renderModal(ENROLLED)
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    const [header, ...rows] = lastCsv()
    const cols = header?.split(',') ?? []
    const at = cols.indexOf('Gender identity')
    expect(cols[at + 1]).toBe('Gender field')
    expect(cols).not.toContain('Gender')
    const byName = (name: string) => rows.find((r) => r.includes(name))?.split(',') ?? []
    expect(byName('Olivia Chen').slice(at, at + 2)).toEqual(['Girl/woman', 'F'])
    expect(byName('Riley Sam').slice(at, at + 2)).toEqual(['Not given', ''])
  })

  it('keeps the modal columns fixed: one Gender column', () => {
    renderModal(ENROLLED)
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.filter((h) => h.includes('Gender'))).toHaveLength(1)
  })
})
