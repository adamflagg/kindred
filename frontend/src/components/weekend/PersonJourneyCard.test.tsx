/**
 * PersonJourneyCard — the Women's/Men's Weekend sidebar's camper journey.
 *
 * kindred#2812 (owner rulings 2026-09-24): every journey surface shows the
 * current year's enrolled sessions, with or without a cabin yet, and this
 * sidebar shows the SAME current-year rows the camper record does — the same
 * build (`useCamperHistory` over `useCamperEnrollment`), not a copy of it.
 * The live attendee read and the server feed are mocked at their own hooks;
 * everything between them and the rendered rows is real.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createWrapper } from '../../test/testUtils'
import type { CabinLabel } from '../../hooks/camper/teenCabinLabel'
import type { HistoricalRecord } from '../../hooks/camper/types'
import type { Camper } from '../../types/app-types'
import { PersonJourneyCard } from './PersonJourneyCard'

const YEAR = 2026
const PERSON = 3000001

const enrollment = { value: [] as Camper[] }
const enrollmentCalls: Array<[number | null, number]> = []
vi.mock('../../hooks/camper/useCamperEnrollment', () => ({
  useCamperEnrollment: (personCmId: number | null, year: number) => {
    enrollmentCalls.push([personCmId, year])
    return {
      enrolledCampers: enrollment.value.filter((c) => c.attendee_status === 'enrolled'),
      allAttendees: enrollment.value,
      isLoading: false,
      error: null,
    }
  },
}))

const feed = {
  value: {
    rows: [] as HistoricalRecord[],
    currentYearParentRows: [] as HistoricalRecord[],
    counts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
    isLoading: false,
    error: null as Error | null,
    teenCabinsByWeekend: new Map<string, CabinLabel>(),
    adultCabinsByWeekend: new Map<string, CabinLabel>(),
    familyCabinsByWeekend: new Map<string, CabinLabel>(),
  },
}
vi.mock('../../hooks/camper/useCamperJourney', () => ({
  useCamperJourney: () => feed.value,
}))

vi.mock('../../hooks/camper/fetchCamperJourney', () => ({
  fetchParentMainSessions: () => Promise.resolve(new Map()),
}))

function attendee(opts: {
  sessionCmId: number
  sessionType: string
  name: string
  startDate?: string
  bunkName?: string
}): Camper {
  return {
    person_cm_id: PERSON,
    attendee_status: 'enrolled',
    session_cm_id: opts.sessionCmId,
    assigned_bunk: opts.bunkName ? `bunk-${opts.bunkName}` : '',
    expand: {
      session: {
        cm_id: opts.sessionCmId,
        name: opts.name,
        session_type: opts.sessionType,
        start_date: opts.startDate ?? '',
        end_date: '',
      },
      assigned_bunk: opts.bunkName ? { name: opts.bunkName } : null,
    },
  } as unknown as Camper
}

const WW_2026 = attendee({
  sessionCmId: 1001,
  sessionType: 'adult',
  name: "Women's Weekend",
  startDate: '2026-07-10',
  bunkName: 'Raw Bunk',
})

function cabinCells(): Array<string | null> {
  return within(screen.getByTestId('journey-rows'))
    .getAllByTestId('journey-cabin-cell')
    .map((cell) => cell.textContent)
}

function yearCells(): Array<string | null> {
  return Array.from(screen.getByTestId('journey-rows').querySelectorAll('[data-col="year"]')).map(
    (cell) => cell.textContent
  )
}

beforeEach(() => {
  enrollment.value = []
  enrollmentCalls.length = 0
  feed.value = {
    rows: [],
    currentYearParentRows: [],
    counts: { summers: 0, familyWeekends: 0, adultWeekends: 0 },
    isLoading: false,
    error: null,
    teenCabinsByWeekend: new Map(),
    adultCabinsByWeekend: new Map(),
    familyCabinsByWeekend: new Map(),
  }
})

describe('PersonJourneyCard', () => {
  // Owner ruling 2026-09-24 (on #2814): a family weekend the guest is
  // enrolled on themself shows the household's cabin, as a parent row does.
  it("shows the household's cabin on a family weekend the guest is enrolled on this year", async () => {
    enrollment.value = [
      WW_2026,
      attendee({
        sessionCmId: 106,
        sessionType: 'family',
        name: 'Family Camp 6',
        startDate: '2026-09-18',
      }),
    ]
    feed.value = {
      ...feed.value,
      counts: { summers: 0, familyWeekends: 1, adultWeekends: 1 },
      familyCabinsByWeekend: new Map([
        ['2026:106', { cabinName: 'Meadow House 1', cabinNameRaw: 'Meadow House 1' }],
      ]),
    }

    render(<PersonJourneyCard personCmId={PERSON} year={YEAR} />, { wrapper: createWrapper() })

    await waitFor(() => expect(cabinCells()).toEqual(['', 'Meadow House 1']))
  })

  it("shows a 2026 WW guest's WW 2026 row with its attributed cabin, above the prior years", async () => {
    enrollment.value = [WW_2026]
    feed.value = {
      ...feed.value,
      rows: [
        { year: 2025, sessionName: "Women's Weekend", sessionType: 'adult', bunkName: 'River F' },
      ],
      counts: { summers: 0, familyWeekends: 0, adultWeekends: 2 },
      adultCabinsByWeekend: new Map([
        ['2026:1001', { cabinName: 'Cedar Lodge', cabinNameRaw: 'Cedar Lodge' }],
      ]),
    }

    render(<PersonJourneyCard personCmId={PERSON} year={YEAR} />, { wrapper: createWrapper() })

    await waitFor(() => expect(yearCells()).toEqual(['2026', '2025']))
    expect(enrollmentCalls).toContainEqual([PERSON, YEAR])
    expect(cabinCells()).toEqual(['Cedar Lodge', 'River F'])
    expect(screen.getByText('Now')).toBeInTheDocument()
    expect(screen.queryByText('Raw Bunk')).not.toBeInTheDocument()
    expect(screen.getByText('2 adult weekends')).toBeInTheDocument()
  })

  it('shows the WW 2026 row with no cabin when none has been typed yet', async () => {
    enrollment.value = [WW_2026]
    feed.value = { ...feed.value, counts: { summers: 0, familyWeekends: 0, adultWeekends: 1 } }

    render(<PersonJourneyCard personCmId={PERSON} year={YEAR} />, { wrapper: createWrapper() })

    await waitFor(() => expect(yearCells()).toEqual(['2026']))
    expect(cabinCells()).toEqual([''])
  })

  it("shows a 21+ guest's 2026 household weekends FC1 and FC6, and the count equals the rows shown", async () => {
    enrollment.value = [WW_2026]
    feed.value = {
      ...feed.value,
      currentYearParentRows: [
        {
          year: YEAR,
          sessionName: 'Family Camp 1: Memorial Day Weekend',
          sessionType: 'family',
          bunkName: 'Cedar Lodge',
          startDate: '2026-05-22',
        },
        {
          year: YEAR,
          sessionName: 'Family Camp 6',
          sessionType: 'family',
          bunkName: 'Meadow House 1',
          bunkNameRecorded: 'Old Meadow 1',
          startDate: '2026-09-18',
        },
      ],
      counts: { summers: 0, familyWeekends: 2, adultWeekends: 1 },
      adultCabinsByWeekend: new Map([
        ['2026:1001', { cabinName: 'River F', cabinNameRaw: 'River F' }],
      ]),
    }

    render(<PersonJourneyCard personCmId={PERSON} year={YEAR} />, { wrapper: createWrapper() })

    await waitFor(() => expect(cabinCells()).toEqual(['Cedar Lodge', 'River F', 'Meadow House 1']))
    expect(yearCells()).toEqual(['2026', '', ''])
    expect(screen.getByText('2 family weekends · 1 adult weekend')).toBeInTheDocument()
    expect(screen.getAllByText(/^Family Camp/)).toHaveLength(feed.value.counts.familyWeekends)
  })
})
