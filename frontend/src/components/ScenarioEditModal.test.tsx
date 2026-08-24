/**
 * kindred#2538 tier 2b. ScenarioEditModal is the dialog whose parent gate IS
 * its data — `{editingScenario && <ScenarioEditModal scenario={editingScenario} …>}`
 * — so converting it needs a retained snapshot on the parent side and a
 * per-open remount here.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import ScenarioEditModal from './ScenarioEditModal'

const SCENARIO_A = { id: 'scenario-a', name: 'Plan A', description: 'first' }
const SCENARIO_B = { id: 'scenario-b', name: 'Plan B', description: 'second' }

describe('ScenarioEditModal — always-mounted conversion (kindred#2538)', () => {
  it('stays painted on the close frame, then unmounts once the leave completes', async () => {
    const { rerender } = render(
      <ScenarioEditModal
        scenario={SCENARIO_A}
        onClose={vi.fn()}
        onSave={vi.fn()}
        isOpen={true}
        nonce={1}
      />
    )
    expect(screen.getByRole('heading', { name: 'Edit Scenario' })).toBeInTheDocument()

    rerender(
      <ScenarioEditModal
        scenario={SCENARIO_A}
        onClose={vi.fn()}
        onSave={vi.fn()}
        isOpen={false}
        nonce={1}
      />
    )

    // Painted on the close frame — the exit fade has something to fade.
    expect(screen.getByRole('heading', { name: 'Edit Scenario' })).toBeInTheDocument()

    // ...and gone once the leave finishes. Both halves matter: the presence
    // half alone passes vacuously against the unconverted component, which
    // hardcodes `isOpen={true}` and so never unmounts at all.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Edit Scenario' })).not.toBeInTheDocument()
    )
  })

  it('reopening on a DIFFERENT scenario shows that scenario, not the previous one', () => {
    const { rerender } = render(
      <ScenarioEditModal
        scenario={SCENARIO_A}
        onClose={vi.fn()}
        onSave={vi.fn()}
        isOpen={true}
        nonce={1}
      />
    )
    expect(screen.getByLabelText(/Scenario Name/i)).toHaveValue('Plan A')

    rerender(
      <ScenarioEditModal
        scenario={SCENARIO_A}
        onClose={vi.fn()}
        onSave={vi.fn()}
        isOpen={false}
        nonce={1}
      />
    )
    rerender(
      <ScenarioEditModal
        scenario={SCENARIO_B}
        onClose={vi.fn()}
        onSave={vi.fn()}
        isOpen={true}
        nonce={2}
      />
    )

    // `useState(scenario.name)` runs once per mount, so always-mounted and
    // without a remount this still reads 'Plan A' — editing B would rename it.
    expect(screen.getByLabelText(/Scenario Name/i)).toHaveValue('Plan B')
    expect(screen.getByLabelText(/Description/i)).toHaveValue('second')
  })

  it('reopening the SAME scenario after a cancelled edit shows it pristine', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ScenarioEditModal
        scenario={SCENARIO_A}
        onClose={vi.fn()}
        onSave={vi.fn()}
        isOpen={true}
        nonce={1}
      />
    )

    const name = screen.getByLabelText(/Scenario Name/i)
    await user.clear(name)
    await user.type(name, 'ABANDONED DRAFT')

    rerender(
      <ScenarioEditModal
        scenario={SCENARIO_A}
        onClose={vi.fn()}
        onSave={vi.fn()}
        isOpen={false}
        nonce={1}
      />
    )
    rerender(
      <ScenarioEditModal
        scenario={SCENARIO_A}
        onClose={vi.fn()}
        onSave={vi.fn()}
        isOpen={true}
        nonce={2}
      />
    )

    // This is the case kindred#2538 asked to have a decision recorded for, and
    // the reason the remount is keyed on the NONCE and not on `scenario.id`:
    // an id key is unchanged when the same scenario is reopened, React reuses
    // the instance, and the abandoned draft is still in the field for the next
    // Save to write. The nonce bumps on every open, so both cases reset.
    expect(screen.getByLabelText(/Scenario Name/i)).toHaveValue('Plan A')
  })
})
