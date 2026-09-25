/**
 * The Assign modal's "From Jotform" picker suggests the filer from the name
 * staff type (kindred#2839 follow-up, owner report 2026-09-25: a write-in
 * typed as the filer's nametag, or a shortened name, never suggested her
 * form). The filer's folded names come from the server (`name_tiers`); the
 * match itself is `filerMatch.ts`, pinned against the server by shared
 * vectors. An EXACT unique match pre-selects the filing; a SIMILAR one only
 * offers it; once staff pick anything themselves, nothing is auto-selected.
 * Fictional names only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { AssignFamilyModal, type JotformFilingChoice } from './AssignFamilyModal'
import { LodgingBoard } from './LodgingBoard'

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    permissions: [],
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}))
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

const setUnitAvailability = vi.fn()
vi.mock('../../services/lodgingApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/lodgingApi')>()
  return {
    ...actual,
    setUnitAvailability: (...args: unknown[]) => setUnitAvailability(...args) as unknown,
  }
})

const jotformQueue = vi.fn()
vi.mock('../../hooks/useJotformAdmin', () => ({
  useJotformQueue: (year: number, enabled: boolean) => jotformQueue(year, enabled) as unknown,
}))

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 5,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

const EMMA_ID = '6600000000000000021'
const OLIVIA_ID = '6600000000000000022'
const EMMA_TIERS = [['emma johnson'], ['emmy johnson'], ['emmy'], ['emma', 'emmy']]
const FILINGS: JotformFilingChoice[] = [
  { submissionId: EMMA_ID, name: 'Emma Johnson', nametag: 'Emmy', nameTiers: EMMA_TIERS },
  {
    submissionId: OLIVIA_ID,
    name: 'Olivia Chen',
    nametag: '',
    nameTiers: [['olivia chen'], [], [], ['olivia']],
  },
]

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setUnitAvailability.mockReset()
  setUnitAvailability.mockResolvedValue({ record_id: 'w1', deleted: false })
  jotformQueue.mockReset()
  jotformQueue.mockReturnValue({ data: undefined, isLoading: false, error: null })
})

function renderModal(filings: JotformFilingChoice[] = FILINGS, parties: RosterPartyRow[] = []) {
  const onWriteIn = vi.fn()
  render(
    <AssignFamilyModal
      isOpen
      onClose={vi.fn()}
      unit={unit()}
      parties={parties}
      canPlace={false}
      occupants={0}
      onSelect={vi.fn()}
      onWriteIn={onWriteIn}
      jotformFilings={filings}
      sessionType="adult"
    />
  )
  return onWriteIn
}

const picker = () => screen.getByRole('combobox', { name: 'Jotform filing' })

describe('AssignFamilyModal — suggesting the filer from the typed name', () => {
  it("pre-selects the one filing whose nametag was typed, and keeps staff's name", async () => {
    const user = userEvent.setup()
    const onWriteIn = renderModal()
    await user.type(screen.getByRole('searchbox'), 'Emmy')
    expect(picker()).toHaveValue(EMMA_ID)
    expect(screen.getByRole('searchbox')).toHaveValue('Emmy')
    await user.click(screen.getByRole('button', { name: 'Write in' }))
    expect(onWriteIn).toHaveBeenCalledWith({
      occupantName: 'Emmy',
      note: '',
      partySize: null,
      jotformSubmissionId: EMMA_ID,
    })
  })

  it('pre-selects on first + last name too, and lets staff set it back to None', async () => {
    const user = userEvent.setup()
    const onWriteIn = renderModal()
    await user.type(screen.getByRole('searchbox'), 'emma johnson')
    expect(picker()).toHaveValue(EMMA_ID)
    await user.selectOptions(picker(), '')
    await user.click(screen.getByRole('button', { name: 'Write in' }))
    expect(onWriteIn).toHaveBeenCalledWith({
      occupantName: 'emma johnson',
      note: '',
      partySize: null,
    })
  })

  it('only hints at a similar name, and "Use it" picks that filing', async () => {
    const user = userEvent.setup()
    const onWriteIn = renderModal()
    await user.type(screen.getByRole('searchbox'), 'Emny')
    expect(picker()).toHaveValue('')
    expect(screen.getByText("Looks like Emma Johnson's form")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use it' }))
    expect(picker()).toHaveValue(EMMA_ID)
    expect(screen.queryByText("Looks like Emma Johnson's form")).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Write in' }))
    expect(onWriteIn).toHaveBeenCalledWith({
      occupantName: 'Emny',
      note: '',
      partySize: null,
      jotformSubmissionId: EMMA_ID,
    })
  })

  it('hints nothing and selects nothing for a name that is no filer', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByRole('searchbox'), 'Kitchen crew')
    expect(picker()).toHaveValue('')
    expect(screen.queryByText(/Looks like/)).not.toBeInTheDocument()
  })

  it('stops auto-selecting once staff pick anything themselves', async () => {
    const user = userEvent.setup()
    renderModal()
    const search = screen.getByRole('searchbox')
    await user.type(search, 'Emmy')
    expect(picker()).toHaveValue(EMMA_ID)
    await user.selectOptions(picker(), '')
    await user.clear(search)
    await user.type(search, 'Olivia')
    expect(picker()).toHaveValue('')
    await user.clear(search)
    await user.type(search, 'Emny')
    expect(screen.queryByText(/Looks like/)).not.toBeInTheDocument()
  })

  it('never lets a suggestion hide a family the typed name still matches', async () => {
    // Only staff's own pick is "the other way in" (kindred#2837): an
    // auto-selected filing leaves a matching family on screen.
    const user = userEvent.setup()
    renderModal(FILINGS, [
      {
        grain: 'household',
        household_cm_id: 101,
        display_name: 'Chen',
        sort_name: 'Chen',
        adults: [{ adult_number: 1, display_name: 'Olivia Chen', relationship: 'Mother' }],
        children: [],
        party_size: 1,
        unit_code: '',
        unit_name: '',
      },
    ])
    await user.type(screen.getByRole('searchbox'), 'Olivia')
    expect(picker()).toHaveValue(OLIVIA_ID)
    expect(screen.queryByTestId('write-in-region')).not.toBeInTheDocument()
  })
})

describe('LodgingBoard — the filer names reach the picker', () => {
  it("pre-selects from the server's name tiers on an adult weekend", async () => {
    jotformQueue.mockReturnValue({
      data: {
        year: 2026,
        unmatched: [
          {
            submission_id: EMMA_ID,
            session_cm_id: 1000002,
            submitted_name: 'Emma Johnson',
            nametag: 'Emmy',
            submitted_at: '2026-08-31 09:00:00',
            match_status: 'unmatched',
            name_tiers: EMMA_TIERS,
          },
        ],
      },
      isLoading: false,
      error: null,
    })
    const user = userEvent.setup()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/weekend/ww/housing']}>{children}</MemoryRouter>
      </QueryClientProvider>
    )
    render(
      <LodgingBoard
        parties={[]}
        units={[unit()]}
        year={2026}
        sessionCmId={1000002}
        canManage
        sessionType="adult"
      />,
      { wrapper }
    )
    await user.click(screen.getByRole('button', { name: 'Write in an occupant for Cedar 1' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('searchbox'), 'Emmy')
    expect(within(dialog).getByRole('combobox', { name: 'Jotform filing' })).toHaveValue(EMMA_ID)
  })
})
