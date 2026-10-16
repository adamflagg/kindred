/**
 * Drill-downs can group by household (epic #3207 PR 6b, decision 39). The owner's rulings on the
 * mock (2026-10-15 ~22:00 PT) are the spec:
 * - #36 a "Group: Flat | Household" switch after Rows; the Group and Rows switches keep their place
 *   whether or not Open All / Close All show, so nothing jumps (the buttons' space is kept).
 * - #37 it opens Flat every time. #38 groups start open, with Open All / Close All.
 * - #39 groups run in the order of their first camper under the list's sort.
 * - #40 a group reads "2 campers · 3 enrollments". #41 a household of one is still a group.
 * - #42 the CSV always has a Household ID column. #43 Retention groups too.
 * - #44 "Baker / Rossi". #45 every group adds its town. #46 the kit's green section row.
 * - #47 the subtitle adds "· N households" while grouped.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DrillDownModal } from './DrillDownModal'
import { CS_BAND } from '../camperships/kit/kitStyles'
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

const ENROLLED: DrilldownFilter = { type: 'status', value: 'enrolled', label: 'Enrolled Campers' }
const WAITLISTED: DrilldownFilter = {
  type: 'waitlist_total',
  value: 'all',
  label: 'Total Waitlisted',
}
const RETENTION: DrilldownFilter = {
  type: 'retention_all',
  value: 'all',
  label: '2025 Total Campers',
  retentionContext: { baseYear: 2025, compareYear: 2026 },
}

function camper(overrides: Partial<DrilldownAttendee>): DrilldownAttendee {
  return {
    person_id: 1000001,
    first_name: 'Emma',
    last_name: 'Johnson',
    grade: 6,
    gender: 'F',
    session_name: 'Session 2',
    session_cm_id: 1001,
    status: 'enrolled',
    is_returning: false,
    ...overrides,
  }
}

const session = (name: string, cmId: number, applied: string) => ({
  session_name: name,
  session_cm_id: cmId,
  effective_date: applied,
  enrollment_date: applied,
})

/**
 * Ava Baker and Leo Rossi share household 5001 (a blended family); Leo has two enrollments.
 * Liam and Mia Garcia are two different households with one surname.
 * Name order: Baker, Chen, Garcia Liam, Garcia Mia, Rossi.
 */
function family(): DrilldownAttendee[] {
  return [
    camper({
      person_id: 1000011,
      first_name: 'Ava',
      last_name: 'Baker',
      grade: 5,
      city: 'Riverside',
      household_cm_id: 5001,
      effective_date: '2025-12-01 00:00:00.000Z',
      sessions: [session('Session 2', 1001, '2025-12-01 00:00:00.000Z')],
    }),
    camper({
      person_id: 1000012,
      first_name: 'Leo',
      last_name: 'Rossi',
      grade: 7,
      city: 'Riverside',
      household_cm_id: 5001,
      effective_date: '2025-11-20 00:00:00.000Z',
      sessions: [
        session('Session 2', 1001, '2025-11-20 00:00:00.000Z'),
        session('Session 3', 1002, '2026-02-01 00:00:00.000Z'),
      ],
    }),
    camper({
      person_id: 1000003,
      first_name: 'Olivia',
      last_name: 'Chen',
      grade: 6,
      city: 'Hillcrest',
      household_cm_id: 5002,
      effective_date: '2025-11-01 00:00:00.000Z',
      sessions: [session('Session 4', 1003, '2025-11-01 00:00:00.000Z')],
    }),
    camper({
      person_id: 1000002,
      first_name: 'Liam',
      last_name: 'Garcia',
      grade: 4,
      city: 'Oak Valley',
      household_cm_id: 5003,
      effective_date: '2026-01-10 00:00:00.000Z',
      sessions: [session('Session 2', 1001, '2026-01-10 00:00:00.000Z')],
    }),
    camper({
      person_id: 1000004,
      first_name: 'Mia',
      last_name: 'Garcia',
      grade: 8,
      city: 'Hillcrest',
      household_cm_id: 5004,
      effective_date: '2025-10-15 00:00:00.000Z',
      sessions: [session('Session 3', 1002, '2025-10-15 00:00:00.000Z')],
    }),
  ]
}

const groupSwitch = () => within(screen.getByRole('group', { name: 'Group' }))
const groupByHousehold = () =>
  fireEvent.click(groupSwitch().getByRole('button', { name: 'Household' }))
const headings = () => [...document.querySelectorAll<HTMLElement>('[data-group-heading]')]
const headingLabels = () =>
  headings().map((h) => h.querySelector('button')?.textContent.replace(/^[▾▸]/, '') ?? '')
const headingCounts = () =>
  headings().map((h) => h.querySelector('[data-group-count]')?.textContent ?? '')
const camperNames = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .filter((r) => !r.querySelector('[data-group-heading]'))
    .map((r) => within(r).getAllByRole('cell')[0]?.textContent.replace(/R$/, '') ?? '')

function lastCsv(): string[] {
  const [csv] = mockTriggerCsvDownload.mock.calls.at(-1) as [string, string]
  return csv.trim().split(/\r?\n/)
}

describe('DrillDownModal — group by household (PR 6b)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAttendees = family()
  })

  describe('#36, #37: the Group switch', () => {
    it('sits right after the Rows switch and opens Flat', () => {
      renderModal(ENROLLED)
      const rows = screen.getByRole('group', { name: 'Rows' })
      const group = screen.getByRole('group', { name: 'Group' })
      expect(rows.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(groupSwitch().getByRole('button', { name: 'Flat' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(headings()).toHaveLength(0)
    })

    it('opens Flat every time, even after the last list was grouped', () => {
      const first = renderModal(ENROLLED)
      groupByHousehold()
      expect(headings().length).toBeGreaterThan(0)
      first.unmount()

      renderModal(ENROLLED)
      expect(groupSwitch().getByRole('button', { name: 'Flat' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(headings()).toHaveLength(0)
    })

    it("keeps the Open All / Close All space while Flat, so the switches don't move", () => {
      renderModal(ENROLLED)
      const slot = document.querySelector('[data-fold-buttons]')
      expect(slot).not.toBeNull()
      expect(slot).toHaveClass('invisible')
      expect(screen.queryByRole('button', { name: 'Open All' })).toBeNull()

      groupByHousehold()
      expect(document.querySelector('[data-fold-buttons]')).not.toHaveClass('invisible')
      expect(screen.getByRole('button', { name: 'Open All' })).toBeInTheDocument()
    })

    it('places the buttons after both switches, so showing them shifts neither', () => {
      renderModal(ENROLLED)
      groupByHousehold()
      const group = screen.getByRole('group', { name: 'Group' })
      const slot = document.querySelector('[data-fold-buttons]')
      expect(slot).not.toBeNull()
      expect(group.compareDocumentPosition(slot!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('#43: Retention offers it too, with no Rows switch', () => {
      renderModal(RETENTION)
      expect(screen.queryByRole('group', { name: 'Rows' })).toBeNull()
      groupByHousehold()
      expect(headings().length).toBeGreaterThan(0)
    })
  })

  describe('#39, #41, #44, #45: groups', () => {
    it('#39: run in the order of their first camper under the Name sort, campers inside in that sort', () => {
      renderModal(ENROLLED)
      groupByHousehold()
      expect(headingLabels()).toEqual([
        'Baker / Rossi · Riverside',
        'Chen · Hillcrest',
        'Garcia · Oak Valley',
        'Garcia · Hillcrest',
      ])
      expect(camperNames()).toEqual([
        'Ava Baker',
        'Leo Rossi',
        'Olivia Chen',
        'Liam Garcia',
        'Mia Garcia',
      ])
    })

    it('#39: a column sort re-orders the groups and the rows inside them', () => {
      renderModal(ENROLLED)
      groupByHousehold()
      fireEvent.click(screen.getByRole('button', { name: /^Grade/ }))
      // Grade A→Z: Liam 4, Ava 5, Olivia 6, Leo 7, Mia 8
      expect(headingLabels()).toEqual([
        'Garcia · Oak Valley',
        'Baker / Rossi · Riverside',
        'Chen · Hillcrest',
        'Garcia · Hillcrest',
      ])
      expect(camperNames()).toEqual([
        'Liam Garcia',
        'Ava Baker',
        'Leo Rossi',
        'Olivia Chen',
        'Mia Garcia',
      ])
    })

    it('#39: a waitlist keeps first-come order: each household sits where its first camper applied', () => {
      mockAttendees = family().map((a) => ({ ...a, status: 'waitlisted' }))
      renderModal(WAITLISTED)
      groupByHousehold()
      // Applied: Mia Oct 15, Olivia Nov 1, Leo Nov 20, Ava Dec 1, Liam Jan 10
      expect(headingLabels()).toEqual([
        'Garcia · Hillcrest',
        'Chen · Hillcrest',
        'Baker / Rossi · Riverside',
        'Garcia · Oak Valley',
      ])
      expect(camperNames()).toEqual([
        'Mia Garcia',
        'Olivia Chen',
        'Leo Rossi',
        'Ava Baker',
        'Liam Garcia',
      ])
    })

    it('#40, #41: every group, a household of one included, counts its campers', () => {
      renderModal(ENROLLED)
      groupByHousehold()
      expect(headingCounts()).toEqual(['2 campers', '1 camper', '1 camper', '1 camper'])
    })

    it('#40: on Enrollments rows a group adds its enrollments when they differ', () => {
      renderModal(ENROLLED)
      fireEvent.click(screen.getByRole('button', { name: 'Enrollments' }))
      groupByHousehold()
      const byLabel = Object.fromEntries(headingLabels().map((l, i) => [l, headingCounts()[i]]))
      expect(byLabel['Baker / Rossi · Riverside']).toBe('2 campers · 3 enrollments')
      expect(byLabel['Chen · Hillcrest']).toBe('1 camper')
    })

    it('a camper with no household gets a group of their own, named for their surname', () => {
      mockAttendees = [camper({ person_id: 1000005, last_name: 'Sam', first_name: 'Riley' })]
      renderModal(ENROLLED)
      groupByHousehold()
      expect(headingLabels()).toEqual(['Sam'])
      expect(headingCounts()).toEqual(['1 camper'])
    })

    it("#46: a group's heading is the kit's green section row", () => {
      renderModal(ENROLLED)
      groupByHousehold()
      const cell = headings()[0]!
      expect(cell.tagName).toBe('TD')
      expect(cell.className).toContain(CS_BAND)
      expect(cell).toHaveAttribute('colSpan', String(screen.getAllByRole('columnheader').length))
    })
  })

  describe('#38: groups open and close', () => {
    it('start open, with Open All disabled and Close All ready', () => {
      renderModal(ENROLLED)
      groupByHousehold()
      expect(camperNames()).toHaveLength(5)
      expect(screen.getByRole('button', { name: 'Open All' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Close All' })).toBeEnabled()
    })

    it('a heading folds its own group; then both buttons work', () => {
      renderModal(ENROLLED)
      groupByHousehold()
      fireEvent.click(screen.getByRole('button', { name: /Baker \/ Rossi/ }))
      expect(camperNames()).toEqual(['Olivia Chen', 'Liam Garcia', 'Mia Garcia'])
      expect(headings()[0]?.querySelector('button')?.textContent.startsWith('▸')).toBe(true)
      expect(screen.getByRole('button', { name: 'Open All' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Close All' })).toBeEnabled()
    })

    it('Close All leaves only the headings; Open All brings every camper back', () => {
      renderModal(ENROLLED)
      groupByHousehold()
      fireEvent.click(screen.getByRole('button', { name: 'Close All' }))
      expect(camperNames()).toEqual([])
      expect(headings()).toHaveLength(4)
      expect(screen.getByRole('button', { name: 'Close All' })).toBeDisabled()

      fireEvent.click(screen.getByRole('button', { name: 'Open All' }))
      expect(camperNames()).toHaveLength(5)
    })

    it('changing Rows opens every group again', () => {
      renderModal(ENROLLED)
      groupByHousehold()
      fireEvent.click(screen.getByRole('button', { name: 'Close All' }))
      fireEvent.click(screen.getByRole('button', { name: 'Enrollments' }))
      expect(camperNames()).toHaveLength(6)
    })

    it('an empty list shows both buttons disabled', () => {
      mockAttendees = []
      renderModal(ENROLLED)
      groupByHousehold()
      expect(screen.getByRole('button', { name: 'Open All' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Close All' })).toBeDisabled()
    })
  })

  describe('search', () => {
    it('hides the groups it empties, and a group counts the campers still shown', () => {
      renderModal(ENROLLED)
      groupByHousehold()
      fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'rossi' } })
      expect(headingLabels()).toEqual(['Baker / Rossi · Riverside'])
      expect(headingCounts()).toEqual(['1 camper'])
    })
  })

  describe('#47: the subtitle counts households while grouped', () => {
    it('adds "· N households" only when grouped', () => {
      renderModal(ENROLLED)
      expect(screen.queryByText(/households/)).toBeNull()
      groupByHousehold()
      expect(screen.getByText('2026 enrollment data · 4 households')).toBeInTheDocument()
    })

    it('reads after the camper count on Enrollments rows', () => {
      renderModal(ENROLLED)
      fireEvent.click(screen.getByRole('button', { name: 'Enrollments' }))
      groupByHousehold()
      expect(
        screen.getByText('2026 enrollment data · 5 campers · 4 households')
      ).toBeInTheDocument()
    })

    it('counts the households a search leaves, and says "household" for one', () => {
      renderModal(ENROLLED)
      groupByHousehold()
      fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'garcia' } })
      expect(screen.getByText(/· 2 households/)).toBeInTheDocument()
      fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'olivia' } })
      expect(screen.getByText(/· 1 household \(filtered/)).toBeInTheDocument()
    })
  })

  describe('a numbered note says what a household is', () => {
    it('appears while grouped, after the CSV note', () => {
      renderModal(ENROLLED)
      expect(screen.queryByText(/primary childhood household in CampMinder/)).toBeNull()
      groupByHousehold()
      expect(
        screen.getByText(
          /is the camper's primary childhood household in CampMinder, the one CampMinder groups by\. It is named for its campers' surnames, with its town\./
        )
      ).toBeInTheDocument()
    })
  })

  describe('#42: Download CSV always has Household ID', () => {
    it('flat: a Household ID column before Caregivers, blank with no household', () => {
      mockAttendees = [
        camper({ household_cm_id: 5001, caregivers: ['Sarah Johnson'] }),
        camper({ person_id: 1000005, first_name: 'Riley', last_name: 'Sam' }),
      ]
      renderModal(ENROLLED)
      fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
      const [header, emma, riley] = lastCsv()
      expect(header?.endsWith(',Returning,Household ID,Caregivers')).toBe(true)
      expect(emma?.endsWith(',No,5001,Sarah Johnson')).toBe(true)
      expect(riley?.endsWith(',No,,')).toBe(true)
    })

    it('retention: the same column', () => {
      renderModal(RETENTION)
      fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
      expect(lastCsv()[0]).toContain(',Household ID,Caregivers')
    })

    it("grouped: rows come out in the screen's order, a closed group's rows included", () => {
      renderModal(ENROLLED)
      groupByHousehold()
      fireEvent.click(screen.getByRole('button', { name: /^Grade/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Close All' }))
      fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
      const ids = lastCsv()
        .slice(1)
        .map((line) => line.split(',')[0])
      expect(ids).toEqual(['1000002', '1000011', '1000012', '1000003', '1000004'])
    })
  })
})
