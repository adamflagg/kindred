/**
 * Owner rulings A and B (2026-10-01, Group 1) on a real table and editor, as refined by the plan
 * review (C1, I3, M8, M9). Fictional rows (tests/CLAUDE.md). Saves are held open by hand, so each
 * test decides when one answers.
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useState } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidTable, type AidColumn } from './AidTable'
import { REASON_POLICY, type TextReasonPolicy } from './editor'
import { RequestEditor, type EditorSave } from './RequestEditor'
import { useEditorWalk } from './useEditorWalk'

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
const rowKey = (r: Row) => r.id

interface Held {
  rowKey: string
  save: EditorSave
  resolve: () => void
  reject: (error: Error) => void
}
let held: Held[] = []
const saveSpy = vi.fn(
  (rowKey: string, save: EditorSave) =>
    new Promise<void>((resolve, reject) => {
      held.push({ rowKey, save, resolve, reject })
    })
)
// Every highlight the walk sets, so a test can see that nothing moved after the page was gone.
let moves: Array<string | null> = []

function Walk({
  policy = REASON_POLICY.appeal_ask,
  label = 'Round 2 ask',
  go = () => undefined,
  rowKeys,
}: {
  policy?: TextReasonPolicy
  label?: string
  go?: () => void
  rowKeys?: ReadonlySet<string>
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null)
  // Bumped to remount every editor, as a refetch or a regrouping of the rows does.
  const [epoch, setEpoch] = useState(0)
  // Stable, as the hook asks of every surface (a state setter or a useCallback).
  const move = useCallback((key: string | null) => {
    moves.push(key)
    setHighlighted(key)
  }, [])
  const walk = useEditorWalk({
    highlighted,
    setHighlighted: move,
    save: saveSpy,
    rowKeys,
  })
  return (
    <>
      <AidTable<Row>
        rows={ROWS}
        columns={COLUMNS}
        rowKey={rowKey}
        csvFilename="camperships-test-2027.csv"
        arrowKeys
        highlighted={highlighted}
        onHighlight={walk.onHighlight}
        renderBelowHighlighted={(row, nav) => (
          <RequestEditor
            key={`${walk.editorKey(row.id)}:${String(epoch)}`}
            familyName={row.family}
            householdCmId={row.householdCmId}
            personCmId={row.personCmId}
            amountLabel={label}
            initialAmount={null}
            policy={policy}
            today="2027-04-09"
            preview={{ status: 'idle' }}
            onAmountChange={() => undefined}
            {...walk.editorFor(row.id, nav)}
          />
        )}
      />
      {[...walk.failures].map(([key, message]) => (
        <p key={key}>
          {`Couldn't save ${key}: ${message}`}
          <button type="button" onClick={() => walk.onHighlight(key)}>
            {`Go back to ${key}`}
          </button>
        </p>
      ))}
      <button type="button" onClick={() => setEpoch((e) => e + 1)}>
        Remount the editors
      </button>
      <button type="button" onClick={() => walk.leave('r3', go)}>
        Open the Chen household
      </button>
    </>
  )
}

function Page(props: Parameters<typeof Walk>[0]) {
  const [shown, setShown] = useState(true)
  return (
    <MemoryRouter>
      {shown && <Walk {...props} />}
      <button type="button" onClick={() => setShown(false)}>
        Leave by the app nav
      </button>
    </MemoryRouter>
  )
}

const renderWalk = (props: Parameters<typeof Walk>[0] = {}) => render(<Page {...props} />)
const editing = (family: string) => screen.getByText(new RegExp(`^${family} · household`))
const amountField = () => screen.getByLabelText('Round 2 ask')
const NOTE = 'Family emailed (Apr 9)'
const DOWN = "Round 2 is posted; its ask can't change"

beforeEach(() => {
  held = []
  moves = []
  saveSpy.mockClear()
})

describe('useEditorWalk: ruling A', () => {
  it('↓ moves at once, before the save answers', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    expect(editing('Garcia')).toBeInTheDocument()
    expect(saveSpy).toHaveBeenCalledWith('r1', { amount: 500, reason: NOTE })
    await act(async () => held[0]?.resolve())
    expect(editing('Garcia')).toBeInTheDocument()
  })

  it('a failed save comes back, with the typed amount and the error, when nothing is typed on the next row', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await act(async () => held[0]?.reject(new Error(DOWN)))
    expect(editing('Johnson')).toBeInTheDocument()
    expect(amountField()).toHaveValue('500')
    expect(screen.getByText(DOWN)).toBeInTheDocument()
  })

  it('Enter on the restored amount saves it again', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await act(async () => held[0]?.reject(new Error('The server is down')))
    await userEvent.keyboard('{Enter}')
    expect(saveSpy).toHaveBeenCalledTimes(2)
    expect(saveSpy).toHaveBeenLastCalledWith('r1', { amount: 500, reason: NOTE })
  })

  it("doesn't take focus from a row being typed on: the failure waits for Go back (Decision 3)", async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await userEvent.keyboard('300')
    await act(async () => held[0]?.reject(new Error('The server is down')))
    // Still on Garcia, still typing there.
    expect(editing('Garcia')).toBeInTheDocument()
    expect(amountField()).toHaveValue('300')
    expect(amountField()).toHaveFocus()
    expect(screen.getByText("Couldn't save r1: The server is down")).toBeInTheDocument()
    // Go back is a click on another row: Garcia's 300 is saved first, then Emma's 500 comes back.
    await userEvent.click(screen.getByRole('button', { name: 'Go back to r1' }))
    expect(saveSpy).toHaveBeenLastCalledWith('r2', { amount: 300, reason: NOTE })
    expect(editing('Johnson')).toBeInTheDocument()
    expect(amountField()).toHaveValue('500')
  })

  it('starts a reopened editor from the saved figure once its save lands (M8)', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await userEvent.keyboard('{ArrowUp}')
    expect(amountField()).toHaveValue('500')
    await act(async () => held[0]?.resolve())
    // The opening figure here is "nothing yet"; a real surface's refetch brings the saved 500.
    expect(amountField()).toHaveValue('')
    await userEvent.keyboard('{ArrowDown}')
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })
})

describe('useEditorWalk: ↑ saves like ↓ (sitting A, A18)', () => {
  it('↑ from a row with unsaved typing saves it, then moves up', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Liam Garcia'))
    await userEvent.keyboard('300{ArrowUp}')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(saveSpy).toHaveBeenCalledWith('r2', { amount: 300, reason: NOTE })
    expect(editing('Johnson')).toBeInTheDocument()
  })
})

describe('useEditorWalk: ruling B', () => {
  it('a click on another row with something typed saves first, then moves', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500')
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(saveSpy).toHaveBeenCalledWith('r1', { amount: 500, reason: NOTE })
    expect(editing('Chen')).toBeInTheDocument()
  })

  it('a click-save that fails comes back as ↓ does', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500')
    await userEvent.click(screen.getByText('Olivia Chen'))
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(editing('Johnson')).toBeInTheDocument()
    expect(amountField()).toHaveValue('500')
  })

  it('something that can’t be saved yet keeps the row and says why, once (Decision 5; M9)', async () => {
    renderWalk({ policy: REASON_POLICY.round3_ask, label: 'Round 3 ask' })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('450')
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(saveSpy).not.toHaveBeenCalled()
    expect(editing('Johnson')).toBeInTheDocument()
    expect(screen.getAllByText('Statement of need is required')).toHaveLength(1)
  })

  it('a click with nothing typed just moves', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(saveSpy).not.toHaveBeenCalled()
    expect(editing('Chen')).toBeInTheDocument()
  })

  it('Esc throws away what was typed and closes, saving nothing', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{Escape}')
    expect(saveSpy).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
  })

  it('Enter saves in place; a failure keeps the editor, the amount and the error', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{Enter}')
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(editing('Johnson')).toBeInTheDocument()
    expect(amountField()).toHaveValue('500')
    expect(screen.getByText('The server is down')).toBeInTheDocument()
  })
})

describe('useEditorWalk: leaving (C1; Decision 4)', () => {
  it('saves what is typed first, and goes only once saved', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500')
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    expect(saveSpy).toHaveBeenCalledWith('r1', { amount: 500, reason: NOTE })
    expect(go).not.toHaveBeenCalled()
    await act(async () => held[0]?.resolve())
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('waits for a ↓ save still in flight, and stays on its row if it fails (the review probe)', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    // Garcia has nothing typed, so leaving has nothing of its own to save; Emma's save is in flight.
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    expect(go).not.toHaveBeenCalled()
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(go).not.toHaveBeenCalled()
    expect(editing('Johnson')).toBeInTheDocument()
    expect(amountField()).toHaveValue('500')
    expect(screen.getByText('The server is down')).toBeInTheDocument()
  })

  it('stays while a failed save is still listed, until it is saved or thrown away', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    // Typing on Garcia, so the failure doesn't take focus: it is only listed (Decision 3).
    await userEvent.keyboard('300')
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(editing('Garcia')).toBeInTheDocument()
    // Throw Garcia's 300 away; nothing is typed or in flight now, but Emma's 500 is still listed.
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    expect(go).not.toHaveBeenCalled()
    expect(editing('Johnson')).toBeInTheDocument()
    expect(amountField()).toHaveValue('500')
    // Thrown away on purpose: now the page may go.
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    expect(go).toHaveBeenCalledTimes(1)
    expect(saveSpy).toHaveBeenCalledTimes(1)
  })

  it('a failed save on leaving stays, with the error, and never goes', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500')
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(go).not.toHaveBeenCalled()
    expect(editing('Johnson')).toBeInTheDocument()
    expect(screen.getByText('The server is down')).toBeInTheDocument()
  })

  it('leaving with nothing typed and nothing in flight goes at once', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    expect(saveSpy).not.toHaveBeenCalled()
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('moves nothing once the page is gone, whatever answers late', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    const before = [...moves]
    // A way out the walk can't see (the app nav): the walk unmounts with the save in flight.
    await userEvent.click(screen.getByRole('button', { name: 'Leave by the app nav' }))
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(moves).toEqual(before)
  })
})

describe('useEditorWalk: fix round 1 (races found in review)', () => {
  it('keeps what was typed after a reopened row saved (M8, the typed-more half)', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await userEvent.keyboard('{ArrowUp}')
    await userEvent.keyboard('0')
    expect(amountField()).toHaveValue('5000')
    await act(async () => held[0]?.resolve())
    expect(amountField()).toHaveValue('5000')
  })

  it('a second ↓ while the first save is in flight saves both and keeps moving', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await userEvent.keyboard('300{ArrowDown}')
    expect(editing('Chen')).toBeInTheDocument()
    expect(saveSpy).toHaveBeenNthCalledWith(1, 'r1', { amount: 500, reason: NOTE })
    expect(saveSpy).toHaveBeenNthCalledWith(2, 'r2', { amount: 300, reason: NOTE })
    await act(async () => held[0]?.resolve())
    await act(async () => held[1]?.resolve())
    expect(editing('Chen')).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't save/)).toBeNull()
  })

  it("doesn't write a row again while the same figure is still in flight", async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await userEvent.keyboard('{ArrowUp}')
    expect(amountField()).toHaveValue('500')
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(editing('Chen')).toBeInTheDocument()
  })

  it('a superseded save that fails late leaves no phantom failure on a row that saved (P1b)', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await userEvent.keyboard('{ArrowUp}')
    await userEvent.keyboard('0')
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(saveSpy).toHaveBeenCalledTimes(2)
    expect(saveSpy).toHaveBeenLastCalledWith('r1', { amount: 5000, reason: NOTE })
    await act(async () => held[0]?.reject(new Error('first failed')))
    await act(async () => held[1]?.resolve())
    expect(screen.queryByText(/Couldn't save/)).toBeNull()
    expect(editing('Chen')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('what is typed while leaving waits is saved too, and the page goes only after (P2)', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    await userEvent.click(amountField())
    await userEvent.keyboard('300')
    await act(async () => held[0]?.resolve())
    expect(go).not.toHaveBeenCalled()
    expect(saveSpy).toHaveBeenLastCalledWith('r2', { amount: 300, reason: NOTE })
    await act(async () => held[1]?.resolve())
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('a save started while leaving waits is awaited, and its failure keeps the person here (P3)', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    await userEvent.click(amountField())
    await userEvent.keyboard('300{Enter}')
    expect(saveSpy).toHaveBeenCalledTimes(2)
    await act(async () => held[0]?.resolve())
    expect(go).not.toHaveBeenCalled()
    await act(async () => held[1]?.reject(new Error('The server is down')))
    expect(go).not.toHaveBeenCalled()
    expect(editing('Garcia')).toBeInTheDocument()
    expect(amountField()).toHaveValue('300')
    expect(screen.getByText('The server is down')).toBeInTheDocument()
  })

  it('a second leave while one is waiting goes once, not twice', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    const leave = screen.getByRole('button', { name: 'Open the Chen household' })
    await userEvent.click(leave)
    await userEvent.click(leave)
    await act(async () => held[0]?.resolve())
    expect(go).toHaveBeenCalledTimes(1)
  })
})

describe('useEditorWalk: final fix wave (review probes)', () => {
  const leaveButton = () => screen.getByRole('button', { name: 'Open the Chen household' })

  it('leave: a failure found while waiting never takes the row being typed on (P2)', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await userEvent.keyboard('300')
    await userEvent.click(leaveButton())
    await userEvent.click(amountField())
    await userEvent.keyboard('7')
    await act(async () => held[1]?.resolve())
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(go).not.toHaveBeenCalled()
    expect(editing('Garcia')).toBeInTheDocument()
    expect(amountField()).toHaveValue('3007')
    expect(screen.getByText("Couldn't save r1: The server is down")).toBeInTheDocument()
  })

  it('leave: nor does it take a row with something that cannot be saved yet typed (P6)', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await userEvent.click(leaveButton())
    await userEvent.click(amountField())
    await userEvent.keyboard('12,5')
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(go).not.toHaveBeenCalled()
    expect(editing('Garcia')).toBeInTheDocument()
    expect(amountField()).toHaveValue('12,5')
    expect(screen.getByText("Couldn't save r1: The server is down")).toBeInTheDocument()
  })

  it('a failed Enter-save survives a remount of its editor, and leaving still stays (P1)', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{Enter}')
    await act(async () => held[0]?.reject(new Error('The server is down')))
    await userEvent.click(screen.getByRole('button', { name: 'Remount the editors' }))
    expect(amountField()).toHaveValue('500')
    expect(screen.getByText("Couldn't save r1: The server is down")).toBeInTheDocument()
    await userEvent.click(leaveButton())
    expect(go).not.toHaveBeenCalled()
  })

  it('a refused Enter-save replaces the stash a failed ↓ left, so a remount shows the newer figure', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    await act(async () => held[0]?.reject(new Error(DOWN)))
    expect(amountField()).toHaveValue('500')
    // Back on the row: 500 becomes 5000 and Enter is refused too.
    await userEvent.type(amountField(), '0{Enter}')
    await act(async () => held[1]?.reject(new Error(DOWN)))
    await userEvent.click(screen.getByRole('button', { name: 'Remount the editors' }))
    expect(amountField()).toHaveValue('5000')
    expect(screen.getByText(`Couldn't save r1: ${DOWN}`)).toBeInTheDocument()
  })

  it('a landed Enter-save is not written again when the person leaves', async () => {
    const go = vi.fn()
    renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{Enter}')
    await act(async () => held[0]?.resolve())
    await userEvent.click(leaveButton())
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('a superseded save settling does not end the saving state of the newer one', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    // Back on Emma (the ↓ save is still out), the figure changes and a click away writes it: that
    // second save supersedes the first.
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.type(amountField(), '0')
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(saveSpy).toHaveBeenCalledTimes(2)
    await act(async () => held[0]?.resolve())
    await userEvent.click(screen.getByText('Emma Johnson'))
    // The newer save is still out, so Enter has to wait for it.
    await userEvent.type(amountField(), '0{Enter}')
    expect(saveSpy).toHaveBeenCalledTimes(2)
  })

  it('an Enter-save followed by a click away comes back like a ↓ when it fails (P4)', async () => {
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{Enter}')
    await userEvent.click(screen.getByText('Olivia Chen'))
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(editing('Chen')).toBeInTheDocument()
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(editing('Johnson')).toBeInTheDocument()
    expect(amountField()).toHaveValue('500')
  })

  it('a successful Enter-save does not remount or flash the old figure', async () => {
    // Regression guard: stashing happens on failure only, so M8's remount is not triggered.
    renderWalk()
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{Enter}')
    await act(async () => held[0]?.resolve())
    expect(amountField()).toHaveValue('500')
  })
})

describe('useEditorWalk: rowKeys (build ruling 2)', () => {
  it("drops a failure for a row the surface no longer has, so it can't hold a leave", async () => {
    const go = vi.fn()
    const { rerender } = renderWalk({ go })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}300')
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(screen.getByText("Couldn't save r1: The server is down")).toBeInTheDocument()
    rerender(<Page go={go} rowKeys={new Set(['r2', 'r3'])} />)
    expect(screen.queryByText(/Couldn't save r1/)).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    expect(go).toHaveBeenCalledTimes(1)
  })

  it('keeps holding a leave for a failure on a row it still has', async () => {
    // Regression guard: the filter drops only rows the surface lost.
    const go = vi.fn()
    renderWalk({ go, rowKeys: new Set(['r1', 'r2', 'r3']) })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}300')
    await act(async () => held[0]?.reject(new Error('The server is down')))
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Open the Chen household' }))
    expect(go).not.toHaveBeenCalled()
  })

  it("doesn't jump back to a failed row the surface no longer has (M4)", async () => {
    const { rerender } = renderWalk({ rowKeys: new Set(['r1', 'r2', 'r3']) })
    await userEvent.click(screen.getByText('Emma Johnson'))
    await userEvent.keyboard('500{ArrowDown}')
    rerender(<Page rowKeys={new Set(['r2', 'r3'])} />)
    moves = []
    await act(async () => held[0]?.reject(new Error('The server is down')))
    expect(moves).toEqual([])
    expect(editing('Garcia')).toBeInTheDocument()
  })
})
