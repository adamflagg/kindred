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
