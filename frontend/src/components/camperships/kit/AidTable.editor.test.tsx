/**
 * The editor row and the table together (Ruling 2026-10-01 (plan review), finding 3): rows can be
 * walked with the editor open, and the table's own ↑/↓ never move the highlight a second time.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'
import { REASON_POLICY } from './editor'
import { RequestEditor } from './RequestEditor'

interface Row {
  id: string
  family: string
  camper: string
  householdCmId: number
  personCmId: number
}

const ROWS: Row[] = [
  {
    id: 'r1',
    family: 'Johnson',
    camper: 'Emma Johnson',
    householdCmId: 1000001,
    personCmId: 1000002,
  },
  {
    id: 'r2',
    family: 'Garcia',
    camper: 'Liam Garcia',
    householdCmId: 1000003,
    personCmId: 1000004,
  },
  { id: 'r3', family: 'Chen', camper: 'Olivia Chen', householdCmId: 1000005, personCmId: 1000006 },
]

const COLUMNS: Array<AidColumn<Row>> = [
  { key: 'family', header: 'Family', width: 110, pinned: true, value: (r) => r.family },
  { key: 'camper', header: 'Camper', flex: true, value: (r) => r.camper },
]

function renderWalk() {
  const saved = vi.fn()
  render(
    <MemoryRouter>
      <AidTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={(r) => r.id}
        csvFilename="camperships-test-2027.csv"
        arrowKeys
        renderBelowHighlighted={(row, nav) => (
          <RequestEditor
            familyName={row.family}
            householdCmId={row.householdCmId}
            personCmId={row.personCmId}
            amountLabel="Round 2 ask"
            initialAmount={null}
            policy={REASON_POLICY.appeal_ask}
            today="2027-04-09"
            preview={{ status: 'idle' }}
            onAmountChange={() => undefined}
            onSave={(save) => saved(row.id, save)}
            onMove={(direction, save) => {
              if (save) saved(row.id, save)
              if (direction === 1) nav.next()
              else nav.previous()
            }}
            onCancel={nav.close}
          />
        )}
      />
    </MemoryRouter>
  )
  return saved
}

const editingFamily = (family: string) => screen.getByText(new RegExp(`^${family} · household`))

describe('walking rows with the editor open', () => {
  it('moves one row per key, saves only what was typed, and closes on Esc', async () => {
    const saved = renderWalk()

    await userEvent.click(screen.getByText('Emma Johnson'))
    expect(editingFamily('Johnson')).toBeInTheDocument()
    expect(screen.getByLabelText('Round 2 ask')).toHaveFocus()

    await userEvent.keyboard('{ArrowDown}')
    expect(editingFamily('Garcia')).toBeInTheDocument()
    expect(screen.getByLabelText('Round 2 ask')).toHaveFocus()
    expect(saved).not.toHaveBeenCalled()

    await userEvent.keyboard('500{ArrowDown}')
    expect(saved).toHaveBeenCalledWith('r2', { amount: 500, reason: 'Family emailed (Apr 9)' })
    expect(editingFamily('Chen')).toBeInTheDocument()

    await userEvent.keyboard('{ArrowUp}')
    expect(editingFamily('Garcia')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(screen.getByText('Liam Garcia').closest('tr')).not.toHaveAttribute('data-highlighted')
  })

  // Like the group headings' sticky-left span: focus must not snap a wide, right-scrolled table back left.
  it('pins the editor row to the left edge the way a group heading is', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    const wrapper = screen
      .getByLabelText('Round 2 ask')
      .closest('[data-aid-editor]')?.firstElementChild
    expect(wrapper).toHaveClass('sticky', 'left-3', 'w-fit')
  })
})
