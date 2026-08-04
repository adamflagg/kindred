/**
 * Mode badge + scenario selector for one weekend.
 *
 * Modelled on summer's `SessionHeader` (`components/session/SessionHeader.tsx`
 * :132-171) — the same `ModeBadge`, the same Listbox with CampMinder first and
 * "+ New Scenario" last, the same `bunking.manage` gate. See CLAUDE.md §4,
 * "Family Camp Models Summer".
 *
 * ONE divergence, and it is deliberate. The modal's "Copy from CampMinder"
 * option is hidden here: that copy is `api/routers/scenarios.py`'s, which
 * copies `bunk_assignments` and returns ZERO rows for a weekend session. It is
 * inert rather than dangerous, but offering staff a checkbox that does nothing
 * is worse than not offering it. The lodging seed is a different endpoint
 * entirely and lives on `SeedScenarioNotice`.
 */
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ChevronDown, Settings } from 'lucide-react'
import { useState } from 'react'

import ModeBadge from '../ModeBadge'
import NewScenarioModal from '../NewScenarioModal'
import ScenarioManagementModal from '../ScenarioManagementModal'
import { useScenario } from '../../hooks/useScenario'
import { useSeedScenario } from '../../hooks/useSeedScenario'

/**
 * The create modal's weekend-only copy source.
 *
 * Not a `{ fromProduction }` or `{ fromScenario }` value — those ride inside
 * `POST /api/scenarios`. This one is reported back to us after creation and
 * we run `POST /api/lodging/placements/copy` ourselves, because that endpoint
 * needs the scenario id the create has not returned yet.
 */
const MIRROR_SOURCE = 'lodging-mirror'

export interface WeekendScenarioPickerProps {
  /** The weekend on screen. Scenarios are per-session. */
  sessionCmId: number
  /** The configured year, for the seed call. */
  year: number
  /** `bunking.manage` — what the lodging_* write rules gate on. */
  canManage: boolean
  /** The selection scoped to THIS weekend; `''` is the mirror. */
  scenario: string
}

export function WeekendScenarioPicker({
  sessionCmId,
  year,
  canManage,
  scenario,
}: WeekendScenarioPickerProps) {
  const { currentScenario, scenarios, selectScenario, isLoading } = useScenario()
  const { seed } = useSeedScenario(year, sessionCmId)
  const [showNewModal, setShowNewModal] = useState(false)
  const [showManageModal, setShowManageModal] = useState(false)

  // Read from the SCOPED value, not from `currentScenario` directly: a
  // selection belonging to another weekend must not badge this one as a draft.
  const active = scenario === '' ? null : currentScenario

  const handleChange = (value: string) => {
    if (value === 'new') {
      setShowNewModal(true)
      return
    }
    selectScenario(value === 'production' ? null : value)
  }

  return (
    <>
      <ModeBadge isProductionMode={active === null} scenarioName={active?.name} />

      {canManage && (
        <Listbox value={active?.id ?? 'production'} onChange={handleChange} disabled={isLoading}>
          <div className="relative">
            <ListboxButton
              aria-label="Scenario"
              className="listbox-button-compact max-w-[150px] min-w-[150px]"
              title={active?.name ?? 'CampMinder'}
            >
              <span className="flex-1 truncate text-left">{active?.name ?? 'CampMinder'}</span>
              <ChevronDown className="text-muted-foreground h-4 w-4 flex-shrink-0" />
            </ListboxButton>
            <ListboxOptions className="listbox-options w-auto min-w-[180px]">
              <ListboxOption value="production" className="listbox-option py-1.5">
                CampMinder
              </ListboxOption>
              {scenarios.map((option) => (
                <ListboxOption key={option.id} value={option.id} className="listbox-option py-1.5">
                  {option.name}
                </ListboxOption>
              ))}
              <ListboxOption
                value="new"
                className="listbox-option text-primary border-border mt-1 border-t py-1.5 pt-2 font-medium"
              >
                + New Scenario
              </ListboxOption>
            </ListboxOptions>
          </div>
        </Listbox>
      )}

      {/* Rename and delete, behind the same gear summer's SessionHeader uses.
          Gated with the picker rather than beside it: it opens the
          DESTRUCTIVE half of the pair, so a viewer who cannot create a plan
          must not be able to delete one. */}
      {canManage && (
        <button
          type="button"
          onClick={() => {
            setShowManageModal(true)
          }}
          className="btn-ghost text-muted-foreground hover:text-foreground p-1.5"
          title="Manage Scenarios"
          aria-label="Manage Scenarios"
        >
          <Settings className="h-4 w-4" />
        </button>
      )}

      {canManage && showManageModal && (
        <ScenarioManagementModal
          sessionId={sessionCmId}
          onClose={() => {
            setShowManageModal(false)
          }}
        />
      )}

      {showNewModal && (
        <NewScenarioModal
          sessionId={sessionCmId}
          canCopyFromProduction={false}
          canCopyFromScenario={false}
          emptyLabel="Start with an empty plan"
          extraSources={[{ value: MIRROR_SOURCE, label: 'Copy placements from CampMinder' }]}
          onClose={() => {
            setShowNewModal(false)
          }}
          onScenarioCreated={async (created, copyFrom) => {
            // CREATE-THEN-SEED, and the seed must name the scenario the
            // create just returned — not the one currently selected, which is
            // whatever staff were looking at a moment ago.
            //
            // Deliberately NOT caught. The hook re-throws a real failure and
            // the modal shows it, staying open over a scenario that now
            // exists and is empty. Swallowing it would close on a lie. The
            // way back is `SeedScenarioNotice`, which renders for exactly
            // that state — so a failed seed is recoverable, not a dead end.
            if (copyFrom === MIRROR_SOURCE) await seed(created.id)
            setShowNewModal(false)
          }}
        />
      )}
    </>
  )
}
