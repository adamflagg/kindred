import { useState } from 'react'
import { Edit, Trash2, RotateCcw, Plus, FlaskConical, Package, Calendar } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useScenario } from '../hooks/useScenario'
import { useYear } from '../hooks/useCurrentYear'
import { useSyncStatusAPI } from '../hooks/useSyncStatusAPI'
import { useRetainedDialog } from '../hooks/useRetainedDialog'
import ScenarioEditModal from './ScenarioEditModal'
import NewScenarioModal from './NewScenarioModal'
import { Modal } from './ui/Modal'
import { toast } from 'react-hot-toast'

interface Scenario {
  id: string
  name: string
  session_cm_id: number
  created_by?: string
  created?: string
  updated?: string
  is_active: boolean
  description?: string
}

interface ScenarioManagementModalProps {
  sessionId: number
  onClose: () => void
  /**
   * Passed straight through to `NewScenarioModal`. `POST /api/scenarios`
   * is program-aware server-side now (kindred#2021), so both programs get
   * the same three choices — this is the one deliberate wording
   * divergence CLAUDE.md §4 permits: a weekend has no bunks to start
   * empty, so it names the thing it does start empty. See
   * `WeekendScenarioPicker`, which passes the weekend wording here; summer
   * (`SessionView`) uses the default.
   */
  emptyLabel?: string
  /**
   * kindred#2538 tier 2b. Always mounted so ui/Modal's 150ms leave can play.
   *
   * Optional and defaulting to TRUE, matching the other tier-2b dialogs: an
   * unconverted call site keeps its old conditional-mount behaviour, so a
   * missed site degrades to "no fade" rather than "a modal appears".
   */
  isOpen?: boolean
}

export default function ScenarioManagementModal({
  sessionId,
  onClose,
  emptyLabel,
  isOpen = true,
}: ScenarioManagementModalProps) {
  const currentYear = useYear()
  // Read `isLoading` (initial query fetch) rather than the combined
  // `loading` flag — otherwise the scenario list is replaced with a
  // "Loading scenarios..." placeholder while a delete/clear is in flight,
  // making the list appear to vanish behind the confirmation dialog.
  const {
    scenarios,
    currentScenario,
    selectScenario,
    updateScenario,
    deleteScenario,
    clearScenario,
    isLoading,
  } = useScenario()
  // Gated on `isOpen` (kindred#2538). Unlike the tier-2b dialogs that split
  // into a shell and a keyed body, this component's state cannot move below
  // <Modal>: its confirm dialog and its two child dialogs are rendered as
  // SIBLINGS of the main Modal, not inside it. So the hook lives at the
  // permanent mount and needs the flag -- ungated, its query and its auth
  // listener stay alive for as long as the panel exists.
  const { data: syncStatus } = useSyncStatusAPI({ enabled: isOpen })

  const editDialog = useRetainedDialog<Scenario>()
  const newScenarioDialog = useRetainedDialog<true>()
  const confirmDialog = useRetainedDialog<{
    type: 'delete' | 'clear'
    scenario: Scenario
  }>()
  const [isProcessing, setIsProcessing] = useState(false)

  // Close every child when this dialog closes (kindred#2538).
  //
  // Modals portal outside `#root` and `modalStack` inerts only `#root`, so a
  // staffer can reach this dialog's close while a child confirm is up. While
  // this component was conditionally mounted that was moot -- its unmount took
  // the children with it. Always-mounted, an unreset child stays on screen
  // with its parent gone.
  //
  // On the isOpen FALLING EDGE rather than inside `onClose`, which is what
  // kindred#2538 suggested: `onClose` only fires for a user-initiated close,
  // so a parent that drops `isOpen` itself would still strand the child. The
  // falling edge covers both. Render-time correction, guarded on the flag
  // actually having changed, so it cannot loop.
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (!isOpen) {
      // `close()` rather than dropping the snapshots: each child plays its own
      // leave, and each hook releases its data in its own afterLeave.
      editDialog.close()
      newScenarioDialog.close()
      confirmDialog.close()
    }
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const handleDelete = async (scenario: Scenario) => {
    setIsProcessing(true)
    try {
      await deleteScenario(scenario.id)
      toast.success(`Deleted scenario: ${scenario.name}`)
      confirmDialog.close()
    } catch {
      toast.error('Failed to delete scenario')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClear = async (scenario: Scenario) => {
    setIsProcessing(true)
    try {
      // The server's own message names the count actually deleted ("Cleared
      // N assignments..."), not a fixed string that reads the same whether
      // 0 or 400 rows were cleared.
      const message = await clearScenario(scenario.id, currentYear, sessionId)
      toast.success(message)
      confirmDialog.close()
    } catch {
      toast.error('Failed to clear scenario')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleUpdate = async (
    scenarioId: string,
    updates: { name?: string; description?: string }
  ) => {
    await updateScenario(scenarioId, updates)
    toast.success('Scenario updated')
  }

  // A local const, not `confirmDialog.data` inline: TypeScript's narrowing
  // from the `!== null` guard below does not survive into the button
  // callbacks, which are closures.
  const confirm = confirmDialog.data

  const headerContent = (
    <div className="border-border border-b p-6 pr-14">
      <h2 className="font-display text-2xl font-bold">Manage Scenarios</h2>
    </div>
  )

  const footerContent = (
    <div className="border-border border-t p-6">
      <button
        onClick={() => newScenarioDialog.open(true)}
        className="btn-primary flex w-full items-center justify-center gap-2 py-3"
      >
        <Plus className="h-5 w-5" />
        Create New Scenario
      </button>
    </div>
  )

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        header={headerContent}
        footer={footerContent}
        size="lg"
        noPadding
      >
        <div className="flex max-h-[60vh] flex-col">
          {/* Production Mode Card */}
          <div className="p-6 pb-0">
            <div
              className={`relative rounded-xl border-2 p-4 ${
                !currentScenario
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-muted/30 hover:bg-muted/50'
              } transition-all`}
            >
              {/* Full-card hit target: keeps the card's own markup as plain
                  divs (button content is phrasing-only, and this card nests
                  a heading + paragraph + badge) while still giving the whole
                  card a native, keyboard-operable control. */}
              <button
                type="button"
                onClick={() => selectScenario(null)}
                aria-label="Switch to CampMinder production mode"
                className="absolute inset-0 h-full w-full cursor-pointer rounded-xl"
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Package className="text-primary h-5 w-5" />
                  <div>
                    <h3 className="font-semibold">CampMinder</h3>
                    <p className="text-muted-foreground text-sm">
                      {syncStatus?.bunk_assignments?.end_time
                        ? `Synced ${formatDistanceToNow(new Date(syncStatus.bunk_assignments.end_time), { addSuffix: true })}`
                        : 'Production bunking assignments'}
                    </p>
                  </div>
                </div>
                {!currentScenario && (
                  <div className="bg-primary/10 text-primary rounded-xl px-3 py-1 text-sm font-medium">
                    Active
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Scenarios List */}
          <div className="flex-1 space-y-3 overflow-y-auto p-6 pt-4">
            {isLoading ? (
              <div className="text-muted-foreground py-8 text-center">Loading scenarios...</div>
            ) : scenarios.length === 0 ? (
              <div className="py-8 text-center">
                <FlaskConical className="text-muted-foreground mx-auto mb-3 h-12 w-12" />
                <p className="text-muted-foreground">No draft scenarios yet</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Create a scenario to experiment with different bunking arrangements
                </p>
              </div>
            ) : (
              scenarios.map((scenario) => (
                <div
                  key={scenario.id}
                  className={`rounded-xl border-2 p-4 ${
                    currentScenario?.id === scenario.id
                      ? 'border-accent bg-accent/5'
                      : 'border-border bg-muted/30 hover:bg-muted/50'
                  } transition-all`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="relative flex-1">
                      {/* Full-row hit target, scoped to this flex-1 column so
                          it doesn't cover the Edit/Clear/Delete buttons in
                          the sibling column. See the CampMinder card above
                          for why this is an overlay button rather than
                          wrapping the (block-content) row in a <button>. */}
                      <button
                        type="button"
                        onClick={() => selectScenario(scenario.id)}
                        aria-label={`Switch to ${scenario.name}`}
                        className="absolute inset-0 h-full w-full cursor-pointer rounded-xl"
                      />
                      <div className="mb-1 flex items-center gap-3">
                        <FlaskConical className="text-accent h-5 w-5" />
                        <h3 className="font-semibold">{scenario.name}</h3>
                        {currentScenario?.id === scenario.id && (
                          <div className="bg-accent/10 text-accent rounded-xl px-3 py-1 text-sm font-medium">
                            Active
                          </div>
                        )}
                      </div>
                      {scenario.description && (
                        <p className="text-muted-foreground mb-2 text-sm">{scenario.description}</p>
                      )}
                      <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <Calendar className="h-3 w-3" />
                        <span>Created {formatDate(scenario.created)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => editDialog.open(scenario)}
                        className="btn-ghost p-2"
                        title="Edit scenario"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => confirmDialog.open({ type: 'clear', scenario })}
                        className="btn-ghost p-2"
                        title="Clear assignments"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => confirmDialog.open({ type: 'delete', scenario })}
                        className="hover:bg-destructive/10 text-destructive rounded-xl p-2 transition-colors"
                        title="Delete scenario"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* Confirmation Dialog */}
      <Modal
        isOpen={confirmDialog.isOpen}
        onClose={() => confirmDialog.close()}
        afterLeave={confirmDialog.afterLeave}
        title={confirmDialog.data?.type === 'delete' ? 'Delete Scenario?' : 'Clear Assignments?'}
        size="sm"
      >
        {confirm !== null && (
          <>
            <p className="text-muted-foreground mb-6">
              {confirm.type === 'delete'
                ? `Are you sure you want to delete "${confirm.scenario.name}"? This action cannot be undone.`
                : `Are you sure you want to clear all assignments in "${confirm.scenario.name}"? This action cannot be undone.`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => confirmDialog.close()}
                className="btn-ghost flex-1 py-2"
                disabled={isProcessing}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirm.type === 'delete') {
                    void handleDelete(confirm.scenario)
                  } else {
                    void handleClear(confirm.scenario)
                  }
                }}
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground shadow-lodge flex-1 rounded-xl px-4 py-2.5 font-semibold transition-all disabled:opacity-50"
                disabled={isProcessing}
              >
                {isProcessing
                  ? confirm.type === 'delete'
                    ? 'Deleting...'
                    : 'Clearing...'
                  : confirm.type === 'delete'
                    ? 'Delete'
                    : 'Clear'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* Edit Modal */}
      {/* Gated on the SNAPSHOT (explicit null check, per useRetainedDialog):
          the gate used to BE the data, which is what unmounted the editor on
          the close frame. */}
      {editDialog.data !== null && (
        <ScenarioEditModal
          scenario={editDialog.data}
          isOpen={editDialog.isOpen}
          nonce={editDialog.nonce}
          afterLeave={editDialog.afterLeave}
          onClose={() => editDialog.close()}
          onSave={handleUpdate}
        />
      )}

      {/* New Scenario Modal */}
      {/* Always mounted (kindred#2538); NewScenarioModal grew its own isOpen +
          nonce in this issue's first commit. This is the third of its three
          gate sites, which that commit left for this one. */}
      <NewScenarioModal
        isOpen={newScenarioDialog.isOpen}
        nonce={newScenarioDialog.nonce}
        sessionId={sessionId}
        {...(emptyLabel !== undefined && { emptyLabel })}
        onClose={() => newScenarioDialog.close()}
        onScenarioCreated={(scenario) => {
          newScenarioDialog.close()
          toast.success(`Created scenario: ${scenario.name}`)
        }}
      />
    </>
  )
}
