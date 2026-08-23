/**
 * The create-scenario modal is SHARED between summer and weekend, and the two
 * programmes do not place the same things.
 *
 * Summer places campers into bunks. A weekend places parties into cabins and
 * rooms, and has no bunks at all — so "Start with empty bunks" is summer's
 * noun leaking into a surface it does not describe. CLAUDE.md §4 asks weekend
 * to model summer's PATTERN; copying its literal vocabulary is the failure
 * that rule exists to catch.
 *
 * The summer defaults are asserted here as hard regression guards. This file
 * exists partly because they were previously unpinned, and parameterising a
 * shared component with no test on the existing caller is how the caller
 * silently changes.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NewScenarioModal from './NewScenarioModal'

const createScenario = vi.fn()

const SUMMER_SCENARIO = {
  id: 'scn7x2k9qw3mnbv',
  name: 'Option A',
  session_cm_id: 1000001,
  is_active: true,
}

vi.mock('../hooks/useScenario', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useScenario')>()
  return {
    ...actual,
    useScenario: () => ({
      currentScenario: null,
      isProductionMode: true,
      scenarios: [SUMMER_SCENARIO],
      isLoading: false,
      isMutating: false,
      error: null,
      loadScenarios: vi.fn(),
      createScenario: (...args: unknown[]) => createScenario(...args),
      selectScenario: vi.fn(),
      updateScenario: vi.fn(),
      deleteScenario: vi.fn(),
      clearScenario: vi.fn(),
    }),
  }
})

vi.mock('../hooks/useCurrentYear', () => ({
  useYear: () => 2026,
  useCurrentYear: () => ({ currentYear: 2026, setCurrentYear: vi.fn() }),
}))

beforeEach(() => {
  createScenario.mockReset().mockResolvedValue({ ...SUMMER_SCENARIO, id: 'scnNEW00000000' })
})

async function fillNameAndSubmit(name = 'Option B') {
  await userEvent.type(screen.getByLabelText(/Scenario Name/i), name)
  await userEvent.click(screen.getByRole('button', { name: /Create Scenario/i }))
}

describe('summer defaults — regression guards', () => {
  it('still says "empty bunks", which is summer\'s correct noun', () => {
    render(<NewScenarioModal sessionId={1000001} onClose={vi.fn()} onScenarioCreated={vi.fn()} />)
    expect(screen.getByLabelText(/Start with empty bunks/i)).toBeInTheDocument()
  })

  it('still offers CampMinder, and still DEFAULTS to it', async () => {
    // `SessionView` and `ScenarioManagementModal` both depend on this default.
    render(<NewScenarioModal sessionId={1000001} onClose={vi.fn()} onScenarioCreated={vi.fn()} />)
    expect(screen.getByLabelText(/Copy from CampMinder/i)).toBeChecked()

    await fillNameAndSubmit()
    await waitFor(() => {
      expect(createScenario).toHaveBeenCalledWith('Option B', 1000001, 2026, undefined, {
        fromProduction: true,
      })
    })
  })

  it('still offers copy-from-another-scenario', () => {
    render(<NewScenarioModal sessionId={1000001} onClose={vi.fn()} onScenarioCreated={vi.fn()} />)
    expect(screen.getByLabelText(/Option A/)).toBeInTheDocument()
  })
})

describe('the empty-plan label is parameterised', () => {
  it('lets a caller name what it is starting empty', () => {
    render(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        emptyLabel="Start with an empty plan"
      />
    )
    expect(screen.getByLabelText(/Start with an empty plan/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/empty bunks/i)).not.toBeInTheDocument()
  })
})

describe('a caller with no source to copy from', () => {
  it('hides copy-from-another-scenario when the caller passes canCopyFromScenario=false', () => {
    render(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        canCopyFromScenario={false}
      />
    )
    expect(screen.queryByLabelText(/Option A/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Copy from scenario/i)).not.toBeInTheDocument()
  })

  it('leaves a caller with no built-in sources defaulting to empty', async () => {
    render(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        canCopyFromProduction={false}
        canCopyFromScenario={false}
      />
    )
    expect(screen.getByLabelText(/Start with empty bunks/i)).toBeChecked()

    await fillNameAndSubmit()
    await waitFor(() => {
      expect(createScenario).toHaveBeenCalledWith('Option B', 1000001, 2026, undefined, {
        fromProduction: false,
      })
    })
  })
})

describe('onScenarioCreated', () => {
  // POST /api/scenarios does the copy server-side now (kindred#2021,
  // program-aware — LodgingWriteService for a weekend session, the existing
  // bunk_assignments(_draft) copy for summer), so by the time this fires the
  // scenario is fully seeded. It is still awaited, though: a caller may have
  // its own work to do with the result (closing a picker, toasting), and a
  // rejection there is still a real failure to show.

  it('AWAITS the caller before finishing', async () => {
    let release: () => void = () => undefined
    const onScenarioCreated = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    render(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={onScenarioCreated}
      />
    )
    await fillNameAndSubmit()

    await waitFor(() => expect(onScenarioCreated).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /Creating/i })).toBeDisabled()

    release()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Creating/i })).not.toBeInTheDocument()
    )
  })

  it('surfaces a caller failure instead of reporting a clean create', async () => {
    const onScenarioCreated = vi.fn().mockRejectedValue(new Error('Failed to notify'))
    render(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={onScenarioCreated}
      />
    )
    await fillNameAndSubmit()

    await waitFor(() => expect(screen.getByText(/Failed to notify/i)).toBeInTheDocument())
  })
})

/**
 * kindred#2538 tier 2b — this dialog is now ALWAYS MOUNTED so it can play
 * ui/Modal's 150ms exit fade, and that changes two things a conditional mount
 * used to handle for free.
 *
 * 1. It must still be in the DOM immediately after close. A parent that
 *    unmounts it on the close frame gives the fade no time to run.
 * 2. Every useState now survives close -> reopen. The reset is driven by a
 *    per-open `nonce` keying the dialog CONTENT (kindred#2541's
 *    useRetainedDialog), which remounts it fresh and re-runs the initializers
 *    against CURRENT props. That last part is why a nonce and not a
 *    reset-effect: `copyFrom`'s initial value is DERIVED from the
 *    canCopyFromProduction prop, so a static re-initializer would reinstate a
 *    stale default.
 */
describe('NewScenarioModal — always-mounted exit fade (kindred#2538)', () => {
  it('stays mounted when isOpen goes false, so the exit fade can play', () => {
    const { rerender } = render(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        isOpen={true}
      />
    )
    expect(screen.getByText('Create New Scenario')).toBeInTheDocument()

    rerender(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        isOpen={false}
      />
    )

    // Still in the DOM on the close frame. Headless UI's Transition removes it
    // 150ms later; asserting absence here would be asserting the bug.
    expect(screen.getByText('Create New Scenario')).toBeInTheDocument()
  })

  it('reopening resets the typed name rather than showing the previous draft', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        isOpen={true}
        nonce={1}
      />
    )

    await user.type(screen.getByLabelText(/Scenario Name/i), 'Draft that should not survive')
    expect(screen.getByLabelText(/Scenario Name/i)).toHaveValue('Draft that should not survive')

    rerender(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        isOpen={false}
        nonce={1}
      />
    )
    rerender(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        isOpen={true}
        nonce={2}
      />
    )

    expect(screen.getByLabelText(/Scenario Name/i)).toHaveValue('')
  })

  it('re-derives copyFrom from the CURRENT prop on reopen, not the mount-time one', () => {
    const { rerender } = render(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        isOpen={true}
        nonce={1}
        canCopyFromProduction={true}
      />
    )
    expect(screen.getByLabelText(/Copy from CampMinder/i)).toBeChecked()

    rerender(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        isOpen={false}
        nonce={1}
        canCopyFromProduction={true}
      />
    )
    rerender(
      <NewScenarioModal
        sessionId={1000001}
        onClose={vi.fn()}
        onScenarioCreated={vi.fn()}
        isOpen={true}
        nonce={2}
        canCopyFromProduction={false}
      />
    )

    // The option is gone, so a surviving 'production' selection would leave NO
    // radio checked and quietly run a copy nobody chose — the exact failure the
    // component's own initializer comment warns about.
    expect(screen.queryByLabelText(/Copy from CampMinder/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Start with empty bunks/i)).toBeChecked()
  })
})
