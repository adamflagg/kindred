import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { householdPage } from './householdFixtures'
import {
  GrantsPostingsSection,
  HistorySection,
  IncomeSection,
  LinksSection,
} from './HouseholdSections'

const downloadSpy = vi.fn()
vi.mock('../../../utils/csvExport', async (importActual) => ({
  ...(await importActual<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (...args: unknown[]) => downloadSpy(...args),
}))

const PAGE = householdPage()

beforeEach(() => downloadSpy.mockClear())

describe('IncomeSection (§6.3 item 5; main spec §9.3)', () => {
  it('shows each answer as sent and as used, a correction beside the original', () => {
    render(<IncomeSection page={PAGE} />)
    const children = screen.getByText('Children').closest('tr') as HTMLElement
    expect(within(children).getByText('2')).toBeInTheDocument()
    expect(within(children).getByText('3')).toBeInTheDocument()
    expect(within(children).getByText('corrected')).toBeInTheDocument()
    // Uncorrected: the form's figure and the one used are the same.
    expect(screen.getAllByText('$84,200', { selector: 'td' })).toHaveLength(2)
  })

  it("shows the family's free-text answers to staff", () => {
    render(<IncomeSection page={PAGE} />)
    expect(screen.getByText('Special financial circumstances')).toBeInTheDocument()
    expect(screen.getByText('Second parent lost work in March.')).toBeInTheDocument()
  })

  it('is the target of an "Enter income" link', () => {
    const { container } = render(<IncomeSection page={PAGE} />)
    expect(container.querySelector('#income')).not.toBeNull()
  })
})

describe('GrantsPostingsSection (§6.3 item 6; D56, D74, D127)', () => {
  it('lists the grants, the Expected chip, and every posting with reversals struck through', () => {
    render(<GrantsPostingsSection page={PAGE} />)
    expect(
      within(screen.getByRole('table', { name: 'Grants' })).getByText('Grantor A')
    ).toBeInTheDocument()
    expect(screen.getByText('Expected: synagogue grant · Emma Johnson')).toBeInTheDocument()
    const postings = within(screen.getByRole('table', { name: 'Postings' }))
    expect(postings.getByText('reversed Mar 20')).toBeInTheDocument()
    expect(postings.getByText('$1,800').tagName).toBe('S')
    expect(postings.getByText('$1,590')).toBeInTheDocument()
  })

  it('marks a grant that is cancelled, and one the band does not count', () => {
    const grant = PAGE.grants[0]!
    render(
      <GrantsPostingsSection
        page={householdPage({
          grants: [
            { ...grant, transaction_cm_id: 1000311, in_band: false },
            { ...grant, transaction_cm_id: 1000312, cancelled: true, in_band: false },
          ],
        })}
      />
    )
    expect(screen.getByText('not counted')).toBeInTheDocument()
    expect(screen.getByText('cancelled')).toBeInTheDocument()
  })

  // The mark follows the server's per-grant in_band flag alone; the page does not re-derive the band's rule.
  it('puts no mark on a grant the server says is in the band', () => {
    render(<GrantsPostingsSection page={PAGE} />)
    const grants = screen.getByRole('table', { name: 'Grants' })
    expect(within(grants).queryByText('not counted')).toBeNull()
    expect(within(grants).queryByText('cancelled')).toBeNull()
  })

  it('puts no mark on a grant split across a live and a withdrawn request (in_band is true)', () => {
    const grant = PAGE.grants[0]!
    render(
      <GrantsPostingsSection
        page={householdPage({
          grants: [
            {
              ...grant,
              in_band: true,
              requests: [
                { request_id: 'reqemma00000001', amount: 600 },
                { request_id: 'reqwithdrawn001', amount: 400 },
              ],
            },
          ],
        })}
      />
    )
    expect(screen.queryByText('not counted')).toBeNull()
  })

  it('trusts in_band true even where the old derived rule (outside funder only) would have marked it', () => {
    const grant = PAGE.grants[0]!
    render(
      <GrantsPostingsSection
        page={householdPage({ grants: [{ ...grant, funder_type: 'other', in_band: true }] })}
      />
    )
    expect(screen.queryByText('not counted')).toBeNull()
  })

  it('marks "not counted" a grant the server says is out of the band, whatever its counts, funder and shares', () => {
    const grant = PAGE.grants[0]!
    expect(grant.counts).toBe(true)
    expect(grant.funder_type).toBe('outside')
    expect(grant.requests.length).toBeGreaterThan(0)
    render(
      <GrantsPostingsSection page={householdPage({ grants: [{ ...grant, in_band: false }] })} />
    )
    expect(screen.getByText('not counted')).toBeInTheDocument()
  })

  it.each([
    ['household', 1000002, 'the household'],
    ['none', 0, 'needs a camper'],
  ] as const)('names an unplaced grant line (basis %s, person %s) "%s"', (basis, person, words) => {
    const grant = PAGE.grants[0]!
    render(
      <GrantsPostingsSection
        page={householdPage({
          grants: [{ ...grant, camper_basis: basis, person_cm_id: person, camper_name: '' }],
        })}
      />
    )
    expect(
      within(screen.getByRole('table', { name: 'Grants' })).getByText(words)
    ).toBeInTheDocument()
  })

  it('downloads the posting history, numbers plain, with the page link last (§11)', async () => {
    render(<GrantsPostingsSection page={PAGE} />)
    await userEvent.click(screen.getByRole('button', { name: 'Download postings' }))
    const [content, filename] = downloadSpy.mock.calls[0] as [string, string]
    expect(filename).toBe('camperships-household-1000001-postings-2027.csv')
    expect(content.split('\n')[1]).toBe(
      '2027-03-09,1000001,1800,2027-03-20,camp_aid,1000010,1000102,summer,'
    )
    expect(content.split('\n').at(-1)).toMatch(/^Link,/)
  })
})

describe('HistorySection (§6.3 item 7)', () => {
  it("lists the family's own log, oldest first, and downloads it", async () => {
    render(<HistorySection page={PAGE} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Jan 5')
    expect(items[1]).toHaveTextContent(
      'test@example.com · Tick posted · decision events reqsamuel000005:1 · Entered in CampMinder'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Download history' }))
    expect(downloadSpy.mock.calls[0]?.[1]).toBe('camperships-household-1000001-history-2027.csv')
  })
})

describe('HistorySection, empty', () => {
  it('offers no download when nothing is recorded', () => {
    render(<HistorySection page={householdPage({ history: [] })} />)
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download history' })).toBeNull()
  })

  it('does not repeat a key for two entries of one operation and record', () => {
    const entry = PAGE.history[0]!
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <HistorySection
        page={householdPage({ history: [entry, { ...entry, entity: 'aid_other' }, { ...entry }] })}
      />
    )
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('same key'))).toHaveLength(0)
    spy.mockRestore()
  })
})

describe('LinksSection (§6.3 †; Decision 27)', () => {
  it('lists linked households, read only, and draws nothing without any', () => {
    const { container, unmount } = render(<LinksSection page={PAGE} />)
    expect(container).toBeEmptyDOMElement()
    unmount()
    render(
      <LinksSection
        page={householdPage({
          links: [
            {
              id: 'link00000000001',
              year: 2027,
              household_cm_id: 1000003,
              family_key: 'fam1',
              source: 'auto',
              excluded: false,
              note: '',
              actor: 'system:intake',
            },
          ],
        })}
      />
    )
    expect(screen.getByText('household 1000003 · auto')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
