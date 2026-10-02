import { useAidScenarioDraft } from '../../../../hooks/camperships/useAidScenarioDraft'
import {
  useAidScenarioSensitivity,
  useAidScenarios,
} from '../../../../hooks/camperships/useAidScenarios'
import { useYear } from '../../../../hooks/useCurrentYear'
import { hasStatus } from '../../../../services/camperships/aidApi'
import type { ApiAidScenarioWorkspace } from '../../../../types/api-types'
import { AMBER_NOTE, BUTTON_PRIMARY, BUTTON_SECONDARY } from '../../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../../QueryGuard'
import { formatLongDate } from '../../kit/dates'
import { SEASON_CARD } from '../seasonStyles'
import { KeptList } from './KeptList'
import { ScenarioLevers } from './ScenarioLevers'
import { ScenarioResults } from './ScenarioResults'
import { hasPending, startingPointOf } from './scenarioModel'

type Draft = ReturnType<typeof useAidScenarioDraft>

function SnapshotLine({ workspace, work }: { workspace: ApiAidScenarioWorkspace; work: Draft }) {
  const snapshot = workspace.snapshot
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {snapshot === null ? (
        <span>The season&apos;s applications aren&apos;t frozen for scenarios yet.</span>
      ) : (
        <span>
          {`Applications frozen ${formatLongDate(snapshot.taken_at)} by ${snapshot.taken_by} · ${String(snapshot.requests)} requests`}
          {snapshot.awaiting_rules > 0 &&
            ` · ${String(snapshot.awaiting_rules)} held in every scenario until programs and cost are approved`}
        </span>
      )}
      <span>
        {`Rules draft v${String(workspace.rules_version)}`}
        {workspace.pricing_version === null
          ? ' · no version prices the season yet'
          : ` · v${String(workspace.pricing_version)} prices the season`}
      </span>
      <button
        type="button"
        className={BUTTON_SECONDARY}
        disabled={work.busy !== null}
        onClick={() => void work.freeze()}
      >
        {snapshot === null ? `Freeze the applications` : 'Freeze again'}
      </button>
    </div>
  )
}

function Workspace({ workspace }: { workspace: ApiAidScenarioWorkspace }) {
  const work = useAidScenarioDraft(workspace)
  const draft = workspace.draft
  const sensitivity = useAidScenarioSensitivity(draft, workspace.snapshot)
  const moving = hasPending(work.pending)
  const results =
    moving && work.live.status === 'ready' ? work.live.results : (draft?.results ?? null)
  const state = !moving ? 'recorded' : work.live.status === 'ready' ? 'moving' : 'working'
  const head = draft === null ? null : startingPointOf(workspace.options, draft.from_code)

  return (
    <div className="space-y-3">
      <SnapshotLine workspace={workspace} work={work} />
      {work.busy !== null && <p className="text-muted-foreground text-sm">{work.busy}</p>}
      {work.error !== null && <p className={AMBER_NOTE}>{work.error}</p>}
      {work.live.status === 'error' && <p className={AMBER_NOTE}>{work.live.error}</p>}
      {workspace.snapshot !== null && draft === null && (
        <div className={`${SEASON_CARD} space-y-2`}>
          <p>Start your draft from:</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON_PRIMARY}
              disabled={work.busy !== null}
              onClick={() => void work.start('rules')}
            >
              {`The rules draft (v${String(workspace.rules_version)})`}
            </button>
            <button
              type="button"
              className={BUTTON_SECONDARY}
              disabled={work.busy !== null}
              onClick={() => void work.start('last_season')}
            >
              Last season&apos;s approved rules
            </button>
          </div>
          {workspace.options.length > 0 && <p className="text-sm">or load a kept option:</p>}
        </div>
      )}
      {workspace.snapshot !== null && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <div className="space-y-3">
            {draft !== null && (
              <div className={SEASON_CARD} data-testid="scenario-draft">
                <span className="bg-forest-700 mr-2 rounded px-1.5 text-xs font-bold text-white">
                  Draft
                </span>
                {`from ${draft.from_code}: ${draft.label}`}
              </div>
            )}
            <div className="card-lodge">
              <div className="text-muted-foreground px-3 pt-2 text-xs font-semibold tracking-wide uppercase">
                Kept (locked)
              </div>
              <KeptList
                options={workspace.options}
                current={draft?.from_code ?? null}
                disabled={work.busy !== null}
                onLoad={(code) => void work.load({ option: code })}
              />
            </div>
            {draft !== null && (
              <ScenarioLevers
                document={draft.document}
                pending={work.pending}
                effects={sensitivity.data?.levers ?? []}
                disabled={work.busy !== null}
                onMove={work.move}
                onRelease={() => void work.release()}
              />
            )}
          </div>
          {draft !== null && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BUTTON_PRIMARY}
                  disabled={work.busy !== null || moving}
                  onClick={() => void work.keep(false)}
                >
                  {`Keep as a variant of ${head ?? ''}`}
                </button>
                <button
                  type="button"
                  className={BUTTON_SECONDARY}
                  disabled={work.busy !== null || moving}
                  onClick={() => void work.keep(true)}
                >
                  Keep as a new starting point
                </button>
              </div>
              {results === null ? (
                <p className="text-muted-foreground text-sm">No figures for this draft yet.</p>
              ) : (
                <ScenarioResults results={results} state={state} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Season › Scenarios (spec §7.4; D35–D38; scenarios-v2.html): finance's own draft per person, kept
 * options in two levels and their trail, all on one frozen snapshot of the season's applications. A
 * scenario never writes live awards; a kept option reaches the rules only through "Make it the rules
 * draft" (PR 6). `rules` only: the tab is hidden from everyone else (D76).
 */
export function ScenariosTab() {
  const year = useYear()
  const workspace = useAidScenarios()
  if (!workspace.data && (hasStatus(workspace.error, 404) || hasStatus(workspace.error, 422))) {
    return (
      <div className={`${SEASON_CARD} text-muted-foreground`}>
        {workspace.error?.message ?? `Scenarios can't open for ${String(year)} yet.`}
      </div>
    )
  }
  return (
    <QueryGuard
      isLoading={workspace.isLoading}
      error={workspace.data ? null : workspace.error}
      data={workspace.data}
      label="Scenarios"
    >
      {(data) => <Workspace workspace={data} />}
    </QueryGuard>
  )
}
