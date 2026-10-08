import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { contentOf, RULES_DOCUMENT } from './rulesFixtures'
import { rulesVocabulary } from './rulesModel'
import { SectionCard } from './SectionCard'

const names = { section: 'round3' as const, ...rulesVocabulary((s) => RULES_DOCUMENT[s]) }

function card(over: Partial<Parameters<typeof SectionCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SectionCard
        section="round3"
        content={contentOf('round3')}
        approved={null}
        names={names}
        status={{
          pill: 'Locked',
          tone: 'stone',
          meta: 'in use since Mar 9, 2027 · finance@example.com',
          note: 'Finance, Jan 20 meeting',
        }}
        changes={[]}
        issues={[]}
        canEdit
        onEdit={vi.fn()}
        {...over}
      />
    </MemoryRouter>
  )
}

describe('a section card (spec §6.2 D)', () => {
  it('heads with its title, the Locked pill and its footnote, the meta and the approval’s Notes on one line, and Edit…', () => {
    card()
    const head = screen.getByTestId('card-head-round3')
    expect(
      within(head).getByRole('heading', { name: 'Who can ask, and how much' })
    ).toBeInTheDocument()
    expect(within(head).getByText('Locked')).toHaveClass('bg-stone-200')
    expect(within(head).getByText('1')).toBeInTheDocument() // the Locked footnote
    expect(within(head).getByText(/· Notes:/)).toHaveTextContent('· Notes: Finance, Jan 20 meeting')
    expect(within(head).queryByText(/Approved by/)).toBeNull()
    expect(within(head).getByRole('button', { name: 'Edit…' })).toBeInTheDocument()
  })

  it('keeps its title in the card face: 13.5px sans, whatever the bare h3 rule says', () => {
    card()
    // fonts.css and index.css style h3 outside any layer, so only an important class beats them (app-wide fix: #2954)
    expect(screen.getByRole('heading', { name: 'Who can ask, and how much' })).toHaveClass(
      '!font-sans',
      '!text-[13.5px]',
      '!leading-normal',
      '!tracking-[inherit]'
    )
  })

  it('opens a truncated meta in full on a click, never on hover', async () => {
    card()
    const meta = screen.getByTestId('card-meta-round3')
    expect(meta).toHaveClass('truncate')
    await userEvent.click(meta)
    expect(meta).not.toHaveClass('truncate')
  })

  it('toggles its warnings, each on its own line, from the issues pill', async () => {
    card({
      issues: [
        {
          section: 'round3',
          code: 'x',
          severity: 'warning',
          path: 'round3',
          message: 'First warning',
        },
        {
          section: 'round3',
          code: 'y',
          severity: 'warning',
          path: 'round3',
          message: 'Second warning',
        },
      ],
    })
    await userEvent.click(screen.getByRole('button', { name: '2 warnings' }))
    expect(screen.getAllByTestId('card-issue').map((li) => li.textContent)).toEqual([
      'First warning',
      'Second warning',
    ])
  })

  it('never counts a note as a warning, and lists only the warnings (B3: notes live on the cells)', async () => {
    const issue = (severity: 'warning' | 'note', message: string) => ({
      section: 'round3' as const,
      code: 'x',
      severity,
      path: 'round3',
      message,
    })
    const { unmount } = card({
      issues: [issue('note', 'A note'), issue('warning', 'The warning'), issue('note', 'Another')],
    })
    await userEvent.click(screen.getByRole('button', { name: '1 warning' }))
    expect(screen.getAllByTestId('card-issue').map((li) => li.textContent)).toEqual(['The warning'])
    unmount()
    card({ issues: [issue('note', 'A note')] })
    expect(screen.queryByRole('button', { name: /warning|note/ })).toBeNull()
  })

  it('reads rows as label · value · description, and its read-only settings as a strip with check marks', () => {
    card()
    const rowEl = screen.getByText("The registrar's limit").closest('[data-card-row]')
    expect(rowEl).toHaveTextContent(
      "The registrar's limit$300A larger amount waits for finance as Pending approval."
    )
    const strip = screen.getByTestId('read-only-strip')
    expect(strip).toHaveTextContent('Read-only4')
    expect(within(strip).getByText('Needs a Round 2 decision first')).toBeInTheDocument()
    expect(within(strip).queryByRole('checkbox')).toBeNull()
  })

  it('says what the draft changed under the header, and "was" beside the value', () => {
    card({
      content: { ...contentOf('round3'), registrar_limit: '400' },
      approved: contentOf('round3'),
      approvedVersion: 3,
      changes: [{ path: ['registrar_limit'], kind: 'changed', before: '300', after: '400' }],
      status: {
        pill: 'Draft · 1 change',
        tone: 'amber',
        meta: 'Jan 21, 2027 · Test User',
        note: null,
      },
    })
    expect(screen.getByTestId('changed-since')).toHaveTextContent(/^Changed since v3:/)
    expect(within(screen.getByTestId('changed-since')).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('was $300')).toBeInTheDocument()
  })

  it('lists the changes one per line, the first three shown and the rest behind "+n more"', async () => {
    const limits = ['registrar_limit', 'a', 'b', 'c', 'd']
    card({
      approvedVersion: 3,
      changes: limits.map((key) => ({ path: [key], kind: 'changed', before: '300', after: '400' })),
    })
    const since = screen.getByTestId('changed-since')
    expect(within(since).getAllByRole('listitem')).toHaveLength(3)
    await userEvent.click(within(since).getByRole('button', { name: '+2 more' }))
    expect(within(since).getAllByRole('listitem')).toHaveLength(5)
    await userEvent.click(within(since).getByRole('button', { name: 'Show fewer' }))
    expect(within(since).getAllByRole('listitem')).toHaveLength(3)
  })

  it('shows a long approval note in full on a click', async () => {
    const note = 'Board approved the weekend rates at the March meeting after the budget review'
    card({ status: { pill: 'In effect', tone: 'emerald', meta: 'Mar 9, 2027', note } })
    const meta = screen.getByTestId('card-meta-round3')
    expect(meta).toHaveClass('truncate')
    await userEvent.click(meta)
    expect(meta).not.toHaveClass('truncate')
    expect(meta).toHaveClass('whitespace-normal')
  })

  it('shows no Edit… when it may not be edited (registrar, past date, another edit open)', () => {
    card({ canEdit: false })
    expect(screen.queryByRole('button', { name: 'Edit…' })).toBeNull()
  })
})

const EQUITY_CONTENT = {
  criteria: [
    {
      key: 'first_gen',
      label: 'First generation',
      source: 'camper',
      field: 'first_gen',
      also_fields: ['first_gen_other'],
      match: 'equals_any',
      values: ['yes'],
      min_value: null,
      enabled: true,
    },
  ],
  weights: { summer: { first_gen: '0.5' } },
  aggregation: 'ceil',
  max_shift: null,
}

it('equity: Show details opens the read-only Reads column, and Hide details closes it', async () => {
  card({ section: 'equity', content: EQUITY_CONTENT, names: { ...names, section: 'equity' } })
  const table = screen.getByTestId('equity-table')
  expect(within(table).queryByRole('columnheader', { name: /^Reads/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Show details' }))
  expect(within(table).getByRole('columnheader', { name: 'Readsread-only' })).toBeInTheDocument()
  expect(within(table).getByText('first gen + first gen other')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Hide details' }))
  expect(within(table).queryByRole('columnheader', { name: /^Reads/ })).toBeNull()
})
