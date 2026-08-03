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
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import ModeBadge from '../ModeBadge'
import NewScenarioModal from '../NewScenarioModal'
import { useScenario } from '../../hooks/useScenario'

export interface WeekendScenarioPickerProps {
  /** The weekend on screen. Scenarios are per-session. */
  sessionCmId: number
  /** `bunking.manage` — what the lodging_* write rules gate on. */
  canManage: boolean
  /** The selection scoped to THIS weekend; `''` is the mirror. */
  scenario: string
}

export function WeekendScenarioPicker({
  sessionCmId,
  canManage,
  scenario,
}: WeekendScenarioPickerProps) {
  const { currentScenario, scenarios, selectScenario, isLoading } = useScenario()
  const [showNewModal, setShowNewModal] = useState(false)

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

      {showNewModal && (
        <NewScenarioModal
          sessionId={sessionCmId}
          canCopyFromProduction={false}
          onClose={() => {
            setShowNewModal(false)
          }}
          onScenarioCreated={() => {
            // `createScenario` already selects it. The new plan is EMPTY —
            // a scenario replaces the mirror (#1974) — and
            // `SeedScenarioNotice` is what offers the way out of that.
            setShowNewModal(false)
          }}
        />
      )}
    </>
  )
}
