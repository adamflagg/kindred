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
    expect(screen.getByText('Grantor A')).toBeInTheDocument()
    expect(screen.getByText('Expected: synagogue grant · Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('reversed Mar 20')).toBeInTheDocument()
    expect(screen.getByText('$1,800').tagName).toBe('S')
    expect(screen.getByText('$1,590')).toBeInTheDocument()
  })

  it("marks a grant that doesn't count or is cancelled, so the table reads against the band's grants", () => {
    const grant = PAGE.grants[0]!
    render(
      <GrantsPostingsSection
        page={householdPage({
          grants: [
            { ...grant, transaction_cm_id: 1000311, counts: false },
            { ...grant, transaction_cm_id: 1000312, cancelled: true },
          ],
        })}
      />
    )
    expect(screen.getByText('not counted')).toBeInTheDocument()
    expect(screen.getByText('cancelled')).toBeInTheDocument()
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
