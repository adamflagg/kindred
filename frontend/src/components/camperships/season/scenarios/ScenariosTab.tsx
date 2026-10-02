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
import { campToday, formatLongDate, formatShortDate } from '../../kit/dates'
import { SEASON_CARD } from '../seasonStyles'
import { KeptList } from './KeptList'
import { ScenarioLevers } from './ScenarioLevers'
import { ScenarioResults } from './ScenarioResults'
import { hasPending, startingPointOf } from './scenarioModel'

type Draft = ReturnType<typeof useAidScenarioDraft>

const STEPS_FAILED = "Couldn't work out each setting's step"

/** The sensitivity read's fault, said once: the client's own fallback already names it. */
function stepsFailed(words: string): string {
  return words.startsWith(STEPS_FAILED) ? words : `${STEPS_FAILED}: ${words}`
}

/** A server timestamp's day on camp time: a freeze at 6 pm Pacific is that day, not the UTC next. */
const campDay = (iso: string) => campToday(new Date(iso))

/** The newest rules version, named as the Rules tab names it: "rules" once it prices the season. */
function rulesName(workspace: ApiAidScenarioWorkspace): string {
  const version = String(workspace.rules_version)
  return workspace.pricing_version === workspace.rules_version
    ? `rules (v${version})`
    : `rules draft (v${version})`
}

function SnapshotLine({ workspace, work }: { workspace: ApiAidScenarioWorkspace; work: Draft }) {
  const snapshot = workspace.snapshot
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {snapshot === null ? (
        <span>The season&apos;s applications aren&apos;t frozen for scenarios yet.</span>
      ) : (
        <span>
          {`Applications frozen ${formatLongDate(campDay(snapshot.taken_at))} by ${snapshot.taken_by} · ${String(snapshot.requests)} requests`}
          {snapshot.awaiting_rules > 0 &&
            ` · ${String(snapshot.awaiting_rules)} held in every scenario: freeze again once programs and cost are approved`}
        </span>
      )}
      <span>
        {workspace.pricing_version === workspace.rules_version
          ? `Rules v${String(workspace.rules_version)} prices the season`
          : `Rules draft v${String(workspace.rules_version)}${
              workspace.pricing_version === null
                ? ' · no version prices the season yet'
                : ` · v${String(workspace.pricing_version)} prices the season`
            }`}
      </span>
      {/* Never held while a write runs: the hook queues a freeze after it (Decision 19). */}
      <button type="button" className={BUTTON_SECONDARY} onClick={() => void work.freeze()}>
        {snapshot === null ? `Freeze the applications` : 'Freeze again'}
      </button>
      {work.nothingToFreeze && snapshot !== null && (
        <span>{`The applications haven't moved since ${formatShortDate(campDay(snapshot.taken_at))}: nothing new to freeze`}</span>
      )}
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
  const state = !moving
    ? 'recorded'
    : work.live.status === 'ready'
      ? 'moving'
      : work.live.status === 'error'
        ? 'failed'
        : 'updating'
  const head = draft === null ? null : startingPointOf(workspace.options, draft.from_code)
  // Held while anything moves or runs, and while the draft is the same as where it came from: the
  // server would only answer "nothing new to keep" (as the mock disables it).
  const unkeepable = work.busy !== null || moving || (draft?.changes.length ?? 0) === 0

  return (
    <div className="space-y-3">
      <SnapshotLine workspace={workspace} work={work} />
      {work.busy !== null && <p className="text-muted-foreground text-sm">{work.busy}</p>}
      {work.error !== null && <p className={AMBER_NOTE}>{work.error}</p>}
      {/* A refused release says its words once: as the write's error, not again as the live one. */}
      {work.live.status === 'error' && work.live.error !== work.error && (
        <p className={AMBER_NOTE}>{work.live.error}</p>
      )}
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
              {`The ${rulesName(workspace)}`}
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
              {/* Never held while a write runs: the hook queues a load after it, so a click while a
                  box still holds typing records the typing first (Decision 19). */}
              <KeptList
                options={workspace.options}
                current={draft?.from_code ?? null}
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
            {draft !== null && sensitivity.error !== null && sensitivity.data === undefined && (
              <p className={`${AMBER_NOTE} flex flex-wrap items-center gap-2`}>
                {stepsFailed(sensitivity.error.message)}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void sensitivity.refetch()}
                >
                  Try again
                </button>
              </p>
            )}
          </div>
          {draft !== null && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BUTTON_PRIMARY}
                  disabled={unkeepable}
                  onClick={() => void work.keep(false)}
                >
                  {`Keep as a variant of ${head ?? ''}`}
                </button>
                <button
                  type="button"
                  className={BUTTON_SECONDARY}
                  disabled={unkeepable}
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
