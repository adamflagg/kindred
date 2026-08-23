/**
 * Mode badge + scenario selector for one weekend.
 *
 * Modelled on summer's `SessionHeader` (`components/session/SessionHeader.tsx`
 * :132-171) — the same `ModeBadge`, the same Listbox with CampMinder first and
 * "+ New Scenario" last, the same `bunking.manage` gate. See CLAUDE.md §4,
 * "Family Camp Models Summer".
 *
 * `POST /api/scenarios` is program-aware server-side now (kindred#2021):
 * weekend copies read `lodging_assignments` / `lodging_assignments_draft`
 * through `LodgingWriteService`, exactly as summer's copy reads
 * `bunk_assignments` / `bunk_assignments_draft`. `NewScenarioModal` is
 * therefore rendered with its DEFAULTS here — both copy choices on offer,
 * same as summer — with `emptyLabel` the one deliberate wording divergence
 * CLAUDE.md §4 permits (a weekend has no bunks to start empty). Before this,
 * both radios had to be hidden and a second endpoint
 * (`copyPlacementsFromMirror` / `SeedScenarioNotice`) papered over the gap;
 * both are retired now that creation itself can copy.
 */
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { ChevronDown, Settings } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'react-hot-toast'

import ModeBadge from '../ModeBadge'
import NewScenarioModal from '../NewScenarioModal'
import ScenarioManagementModal from '../ScenarioManagementModal'
import { useScenario } from '../../hooks/useScenario'
import { useRetainedDialog } from '../../hooks/useRetainedDialog'

/** The one deliberate wording divergence from summer (CLAUDE.md §4). */
const EMPTY_LABEL = 'Start with an empty plan'

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
  // kindred#2538: always-mounted so ui/Modal's 150ms leave can play. See
  // SessionView's twin for why <void> -- no snapshot to retain, but the
  // per-open nonce still remounts the form fresh.
  // <true> rather than <void>: this dialog retains no payload, but eslint's
  // @typescript-eslint/no-invalid-void-type bans a void type argument, and
  // tsc alone does not -- kindred#2549's review flagged that the hook cannot
  // express the no-snapshot variant, and this is the shape of that gap. The
  // literal is inert; only isOpen and nonce are read.
  const newDialog = useRetainedDialog<true>()
  const [showManageModal, setShowManageModal] = useState(false)

  // Read from the SCOPED value, not from `currentScenario` directly: a
  // selection belonging to another weekend must not badge this one as a draft.
  const active = scenario === '' ? null : currentScenario

  const handleChange = (value: string) => {
    if (value === 'new') {
      newDialog.open(true)
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
            <ListboxOptions transition className="listbox-options w-auto min-w-[180px]">
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
          emptyLabel={EMPTY_LABEL}
          onClose={() => {
            setShowManageModal(false)
          }}
        />
      )}

      {/* Unconditional: kindred#2538 keeps this mounted so the exit fade can
          play, with `isOpen` driving it instead of the mount. */}
      <NewScenarioModal
        isOpen={newDialog.isOpen}
        nonce={newDialog.nonce}
        sessionId={sessionCmId}
        emptyLabel={EMPTY_LABEL}
        onClose={() => {
          newDialog.close()
        }}
        onScenarioCreated={(created) => {
          // The create call already did the copy server-side (kindred#2021)
          // — nothing left to do here but close and report, matching
          // summer's own "+ New Scenario" flow (SessionView.tsx).
          newDialog.close()
          // copy_skipped names a mirror/source row whose party or unit no
          // longer resolves — surfaced so staff don't discover fewer
          // families than expected with no explanation. Undefined for a
          // blank creation and always for summer (its copy loop doesn't
          // count skips), so only a truthy count changes the wording.
          toast.success(
            created.copy_skipped
              ? `Created scenario: ${created.name}. Skipped ${String(created.copy_skipped)} — the family or cabin no longer resolves.`
              : `Created scenario: ${created.name}`
          )
        }}
      />
    </>
  )
}
