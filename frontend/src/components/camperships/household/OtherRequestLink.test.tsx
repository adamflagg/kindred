/** Item 4c (owner ruling 10-05): a revived duplicate's banner links the withdrawn request. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow } from '../requests/gridFixtures'
import { applicationOut, householdPage, householdRequest, requestOut } from './householdFixtures'
import { WithdrawnRequestLink } from './OtherRequestLink'

let application: ReturnType<typeof applicationOut> | undefined
const applicationRead = vi.fn()
vi.mock('../../../hooks/camperships/useAidApplication', () => ({
  useAidApplication: (...args: unknown[]) => {
    applicationRead(...args)
    return { data: application, isLoading: false, error: null }
  },
}))
let gridRows: Array<ReturnType<typeof gridRow>> = []
vi.mock('../../../hooks/camperships/useAidGrid', () => ({
  useAidGrid: () => ({ data: { rows: gridRows }, isLoading: false, error: null }),
}))

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
const REVIVED = householdRequest(
  gridRow({
    request_id: 'reqrevived00001',
    household_cm_id: 1000001,
    request_status: 'active',
    holds: [{ code: 'duplicate_survivor_withdrawn', severity: 'hold', message: 'm' }],
  })
)
const WITHDRAWN = householdRequest(
  gridRow({ request_id: 'reqwithdrawn001', request_status: 'withdrawn' })
)
const naming = (survivor: string) =>
  applicationOut({
    requests: [
      requestOut({
        id: 'reqrevived00001',
        status: 'active',
        flags: [{ code: 'duplicate_survivor_withdrawn', detail: { withdrawn_survivor: survivor } }],
      }),
    ],
  })

const renderLink = (requests = [REVIVED, WITHDRAWN], request = REVIVED) =>
  render(
    <MemoryRouter>
      <WithdrawnRequestLink page={householdPage({ requests })} request={request} view={VIEW} />
    </MemoryRouter>
  )

beforeEach(() => {
  application = undefined
  applicationRead.mockReset()
  gridRows = []
})

describe('WithdrawnRequestLink (item 4c)', () => {
  it('scrolls to the withdrawn request when it is on the page', () => {
    application = naming('reqwithdrawn001')
    renderLink()
    expect(screen.getByRole('link', { name: 'Go to the Withdrawn Request ↓' })).toHaveAttribute(
      'href',
      '#request-reqwithdrawn001'
    )
    expect(applicationRead).toHaveBeenCalledWith(1000001, { enabled: true })
  })

  it("opens the withdrawn request's household when it is not on the page", () => {
    application = naming('reqelsewhere001')
    gridRows = [gridRow({ request_id: 'reqelsewhere001', household_cm_id: 1000042 })]
    renderLink([REVIVED])
    expect(screen.getByRole('link', { name: 'Go to the Withdrawn Request ›' })).toHaveAttribute(
      'href',
      '/aid/households/1000042?year=2027'
    )
  })

  it('draws nothing, and reads nothing, for a request without the hold', () => {
    application = naming('reqwithdrawn001')
    const plain = householdRequest(gridRow({ request_id: 'reqplain0000001' }))
    renderLink([plain, WITHDRAWN], plain)
    expect(screen.queryByRole('link')).toBeNull()
    expect(applicationRead).not.toHaveBeenCalledWith(expect.anything(), { enabled: true })
  })
})
