/**
 * A board write-in linked to an adult-weekend Jotform filing (kindred#2759
 * follow-up): the adult card's Handshake mark on the write-in, a bare-bones
 * side panel on click, and making a write-in FROM a filing in the Assign
 * modal. Family Camp draws none of it. Fictional names only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BunkingRequest, LodgingUnitRow } from '../../types/lodging'
import { AssignFamilyModal } from './AssignFamilyModal'
import { LodgingBoard } from './LodgingBoard'
import { WriteInCard } from './WriteInCard'
import { WriteInDetailsPanel } from './WriteInDetailsPanel'
import { writeInEntries } from './writeIn'

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

const REQUEST: BunkingRequest = {
  state: 'request',
  current_text: 'Emma Johnson',
  versions: [{ submitted_at: '2026-08-31 09:00:00', text: 'Emma Johnson' }],
  changed: false,
  coming_with: [],
  submitted: ['2026-08-31 09:00:00'],
  staff_linked: true,
  jotform_says: [],
}

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
    is_family_available: false,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

function writtenInto(bunkingRequest: BunkingRequest | null): LodgingUnitRow {
  return unit({
    write_ins: [
      {
        unit_id: 'u1',
        unit_code: 'cedar-1',
        unit_name: 'Cedar 1',
        occupant_name: 'Pat Doe',
        note: '',
        party_size: null,
        relation: 'own',
        bunking_request: bunkingRequest,
      },
    ],
  })
}

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setUnitAvailability.mockReset()
  setUnitAvailability.mockResolvedValue({ record_id: 'w1', deleted: false })
  jotformQueue.mockReset()
  jotformQueue.mockReturnValue({ data: undefined, isLoading: false, error: null })
})

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/weekend/ww/housing']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('writeInEntries', () => {
  it("carries a linked write-in's bunking request, and nothing for an unlinked one", () => {
    expect(writeInEntries(writtenInto(REQUEST))[0]?.bunkingRequest).toEqual(REQUEST)
    expect(writeInEntries(writtenInto(null))[0]).not.toHaveProperty('bunkingRequest')
  })
})

describe('WriteInCard — a linked write-in', () => {
  const occupant = { name: 'Pat Doe', note: '', partySize: null }

  it('draws the adult card mark and opens on a click', () => {
    const onOpen = vi.fn()
    render(<WriteInCard occupant={occupant} bunkingRequest={REQUEST} onOpen={onOpen} />)
    expect(screen.getByLabelText('Jotform: Has a bunking request')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Pat Doe' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('stays a plain, unclickable card with no link', () => {
    render(<WriteInCard occupant={occupant} onOpen={vi.fn()} />)
    expect(screen.queryByLabelText(/^Jotform:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Pat Doe' })).not.toBeInTheDocument()
  })
})

describe('WriteInDetailsPanel', () => {
  it('is bare-bones: the name, a Write-in tag, and the Jotform request', () => {
    const onClose = vi.fn()
    render(<WriteInDetailsPanel name="Pat Doe" request={REQUEST} onClose={onClose} />)
    const panel = screen.getByRole('dialog', { name: 'Pat Doe details' })
    expect(within(panel).getByRole('heading', { name: 'Pat Doe' })).toBeInTheDocument()
    expect(panel).toHaveTextContent('Write-in')
    expect(panel).toHaveTextContent('Bunking request (Jotform)')
    expect(panel).toHaveTextContent('Emma Johnson')
    expect(panel).not.toHaveTextContent('Housing needs')

    fireEvent.click(within(panel).getByRole('button', { name: 'Close panel' }))
    // Both spellings, as FamilyDetailsPanel.test.tsx does: jsdom has no
    // AnimationEvent, so React listens for the webkit-prefixed one.
    fireEvent(panel, new Event('animationend', { bubbles: true, cancelable: true }))
    fireEvent(panel, new Event('webkitAnimationEnd', { bubbles: true, cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('LodgingBoard — linked write-ins', () => {
  it('opens the write-in panel from its mark on an adult weekend', async () => {
    const user = userEvent.setup()
    render(
      <LodgingBoard
        parties={[]}
        units={[writtenInto(REQUEST)]}
        year={2026}
        sessionCmId={1000002}
        canManage
        sessionType="adult"
      />,
      { wrapper }
    )
    await user.click(screen.getByRole('button', { name: 'Open Pat Doe' }))
    const panel = await screen.findByRole('dialog', { name: 'Pat Doe details' })
    expect(panel).toHaveTextContent('Bunking request (Jotform)')
  })

  it('draws no mark and no panel on a Family Camp weekend, even if a row carries a link', () => {
    render(
      <LodgingBoard
        parties={[]}
        units={[writtenInto(REQUEST)]}
        year={2026}
        sessionCmId={1000001}
        canManage
        sessionType="family"
      />,
      { wrapper }
    )
    expect(screen.queryByLabelText(/^Jotform:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Pat Doe' })).not.toBeInTheDocument()
  })

  it('reads the Jotform queue only for a bunking.manage caller on an adult weekend', () => {
    render(
      <LodgingBoard
        parties={[]}
        units={[unit()]}
        year={2026}
        sessionCmId={1000001}
        canManage
        sessionType="family"
      />,
      { wrapper }
    )
    expect(jotformQueue).toHaveBeenLastCalledWith(2026, false)
    render(
      <LodgingBoard
        parties={[]}
        units={[unit()]}
        year={2026}
        sessionCmId={1000002}
        sessionType="adult"
      />,
      { wrapper }
    )
    expect(jotformQueue).toHaveBeenLastCalledWith(2026, false)
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
    expect(jotformQueue).toHaveBeenLastCalledWith(2026, true)
  })

  it("writes in FROM one of the weekend's unlinked filings, linking it in the same write", async () => {
    jotformQueue.mockReturnValue({
      data: {
        year: 2026,
        unmatched: [
          {
            submission_id: '6600000000000000011',
            session_cm_id: 1000002,
            submitted_name: 'Pat Doe',
            nametag: 'Patty',
            submitted_at: '2026-08-31 09:00:00',
            match_status: 'unmatched',
          },
          {
            submission_id: '6600000000000000012',
            session_cm_id: 1000003,
            submitted_name: 'Riley Sam',
            submitted_at: '2026-08-31 09:00:00',
            match_status: 'unmatched',
          },
        ],
      },
      isLoading: false,
      error: null,
    })
    const user = userEvent.setup()
    render(
      <LodgingBoard
        parties={[]}
        units={[unit({ is_family_available: true })]}
        year={2026}
        sessionCmId={1000002}
        canManage
        sessionType="adult"
      />,
      { wrapper }
    )
    await user.click(screen.getByRole('button', { name: 'Write in an occupant for Cedar 1' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByRole('searchbox'), 'Pat')
    const picker = within(dialog).getByRole('combobox', { name: 'Jotform filing' })
    // Only this weekend's filings.
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['None', 'Pat Doe (nametag “Patty”)'])
    await user.selectOptions(picker, '6600000000000000011')
    expect(within(dialog).getByRole('searchbox')).toHaveValue('Pat Doe')
    await user.click(within(dialog).getByRole('button', { name: 'Write in' }))

    expect(setUnitAvailability).toHaveBeenCalledTimes(1)
    expect(setUnitAvailability.mock.calls[0]?.[1]).toMatchObject({
      familyAvailable: false,
      occupantName: 'Pat Doe',
      jotformSubmissionId: '6600000000000000011',
    })
  })
})

describe('AssignFamilyModal — the Jotform picker', () => {
  function renderModal(
    filings?: Parameters<typeof AssignFamilyModal>[0]['jotformFilings'],
    parties: Parameters<typeof AssignFamilyModal>[0]['parties'] = []
  ) {
    const onWriteIn = vi.fn()
    render(
      <AssignFamilyModal
        isOpen
        onClose={vi.fn()}
        unit={unit({ is_family_available: true })}
        parties={parties}
        canPlace={false}
        occupants={0}
        onSelect={vi.fn()}
        onWriteIn={onWriteIn}
        jotformFilings={filings}
      />
    )
    return onWriteIn
  }

  it('offers no picker without filings, and writes in exactly as before', async () => {
    const user = userEvent.setup()
    const onWriteIn = renderModal()
    await user.type(screen.getByRole('searchbox'), 'Kitchen crew')
    expect(screen.queryByRole('combobox', { name: 'Jotform filing' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Write in' }))
    expect(onWriteIn).toHaveBeenCalledWith({
      occupantName: 'Kitchen crew',
      note: '',
      partySize: null,
    })
  })

  it('shows the picker before anything is typed', () => {
    renderModal([{ submissionId: '6600000000000000011', name: 'Pat Doe', nametag: '' }])
    expect(screen.getByRole('combobox', { name: 'Jotform filing' })).toBeInTheDocument()
  })

  it('writes in a picked filing even when its name also matches a family', async () => {
    // The filer is not registered, so a family sharing the name is not them:
    // picking the filing is the staff member saying "write this person in".
    const user = userEvent.setup()
    const onWriteIn = renderModal(
      [{ submissionId: '6600000000000000011', name: 'Pat Doe', nametag: '' }],
      [
        {
          grain: 'household',
          household_cm_id: 101,
          display_name: 'Doe',
          sort_name: 'Doe',
          adults: [{ adult_number: 1, display_name: 'Pat Doe', relationship: 'Mother' }],
          children: [],
          party_size: 1,
          unit_code: '',
          unit_name: '',
        },
      ]
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Jotform filing' }),
      '6600000000000000011'
    )
    await user.click(screen.getByRole('button', { name: 'Write in' }))
    expect(onWriteIn).toHaveBeenCalledWith({
      occupantName: 'Pat Doe',
      note: '',
      partySize: null,
      jotformSubmissionId: '6600000000000000011',
    })
  })

  it('back to None writes in with no link', async () => {
    const user = userEvent.setup()
    const onWriteIn = renderModal([
      { submissionId: '6600000000000000011', name: 'Pat Doe', nametag: '' },
    ])
    await user.type(screen.getByRole('searchbox'), 'Pat')
    const picker = screen.getByRole('combobox', { name: 'Jotform filing' })
    await user.selectOptions(picker, '6600000000000000011')
    await user.selectOptions(picker, '')
    await user.click(screen.getByRole('button', { name: 'Write in' }))
    expect(onWriteIn).toHaveBeenCalledWith({ occupantName: 'Pat Doe', note: '', partySize: null })
  })
})
