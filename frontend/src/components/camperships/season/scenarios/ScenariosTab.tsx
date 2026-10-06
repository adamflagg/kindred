import { useAidScenarioDraft } from '../../../../hooks/camperships/useAidScenarioDraft'
import {
  useAidScenarioSensitivity,
  useAidScenarios,
} from '../../../../hooks/camperships/useAidScenarios'
import { useYear } from '../../../../hooks/useCurrentYear'
import { hasStatus } from '../../../../services/camperships/aidApi'
import type { ApiAidLeverEffect, ApiAidScenarioWorkspace } from '../../../../types/api-types'
import {
  AMBER_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  GROUP_HEADING,
} from '../../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../../QueryGuard'
import { campToday, formatLongDate, formatShortDate } from '../../kit/dates'
import { SEASON_CARD } from '../seasonStyles'
import { KeptList } from './KeptList'
import { ScenarioLevers } from './ScenarioLevers'
import { ScenarioResults } from './ScenarioResults'
import { changedLevers, hasPending, startingPointOf } from './scenarioModel'
import { CHANGED_NAME, DRAFT_CHIP, DRAFT_ROW } from './scenarioStyles'

type Draft = ReturnType<typeof useAidScenarioDraft>

/** One empty list for every render while the step read is out, never a new one each time. */
const NO_EFFECTS: readonly ApiAidLeverEffect[] = []

const STEPS_FAILED = "Couldn't work out each setting's step"

/** The sensitivity read's fault, said once: the client's own fallback already names it. */
function stepsFailed(words: string): string {
  return words.startsWith(STEPS_FAILED) ? words : `${STEPS_FAILED}: ${words}`
}

/** "6 kept · 2 levels deep" (the mock's count): variants make the second level, never deeper (D38). */
function keptCount(workspace: ApiAidScenarioWorkspace): string {
  const levels = workspace.options.some((option) => option.starting_point !== null) ? 2 : 1
  return `${String(workspace.options.length)} kept · ${String(levels)} level${levels === 1 ? '' : 's'} deep`
}

/** A server timestamp's day on camp time: a freeze at 6 pm Pacific is that day, not the UTC next. */
const campDay = (iso: string) => campToday(new Date(iso))

/** The newest rules version, named as the Rules tab names it: "rules" once it prices the season. */
function rulesName(workspace: ApiAidScenarioWorkspace): string {
  const version = String(workspace.rules_version)
  return workspace.pricing_version === workspace.rules_version
    ? `Rules (v${version})`
    : `Rules Draft (v${version})`
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
            // An approved version pricing the season means programs and cost are approved: the flag
            // stays until the next intake run, so freezing again changes nothing.
            (workspace.pricing_version === null
              ? ` · ${String(snapshot.awaiting_rules)} held in every scenario: freeze again once programs and cost are approved`
              : ` · ${String(snapshot.awaiting_rules)} held in every scenario until the next intake run clears ${snapshot.awaiting_rules === 1 ? 'it' : 'them'}`)}
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
        {snapshot === null ? `Freeze the Applications` : 'Freeze Again'}
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
  // Said in the strip (or under Keep with no figures), never as a line above the grid, which would
  // move the slider under the pointer mid-drag (rereview m1). A refused release says its words once:
  // as the write's error, not again as the live one (F-m6).
  const liveError =
    work.live.status === 'error' && work.live.error !== work.error ? work.live.error : null
  const unkeepable = work.busy !== null || moving || (draft?.changes.length ?? 0) === 0
  const keepButtons = (
    <>
      <button
        type="button"
        className={BUTTON_PRIMARY}
        disabled={unkeepable}
        onClick={() => void work.keep(false)}
      >
        {`Keep as a Variant of ${head ?? ''}`}
      </button>
      <button
        type="button"
        className={BUTTON_SECONDARY}
        disabled={unkeepable}
        onClick={() => void work.keep(true)}
      >
        Keep as a New Starting Point
      </button>
    </>
  )

  return (
    <div className="space-y-3">
      <SnapshotLine workspace={workspace} work={work} />
      {/* Its line is always there, so nothing jumps under the pointer on every release. */}
      <p className="text-muted-foreground h-5 text-sm">{work.busy}</p>
      {work.error !== null && <p className={AMBER_NOTE}>{work.error}</p>}
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
              Last Season&apos;s Approved Rules
            </button>
          </div>
          {workspace.options.length > 0 && <p className="text-sm">or load a kept option:</p>}
        </div>
      )}
      {workspace.snapshot !== null && (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <div className="space-y-3">
            {/* One card, as the mock has it: your draft, then what's kept. */}
            <div className="card-lodge">
              {draft !== null && (
                <>
                  <div className={`${GROUP_HEADING} px-3 pt-2`}>Your draft</div>
                  <div className="px-3 pt-1" data-testid="scenario-draft">
                    <div className={DRAFT_ROW}>
                      <span className={`${DRAFT_CHIP} mr-2`}>Draft</span>
                      {`from ${draft.from_code}: `}
                      <span className={draft.changes.length > 0 ? CHANGED_NAME : ''}>
                        {draft.label}
                      </span>
                    </div>
                  </div>
                </>
              )}
              <div className={`${GROUP_HEADING} flex justify-between gap-2 px-3 pt-2`}>
                <span>Kept (locked)</span>
                {workspace.options.length > 0 && (
                  <span className="font-medium tracking-normal normal-case">
                    {keptCount(workspace)}
                  </span>
                )}
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
                from={draft.from_code}
                pending={work.pending}
                changed={changedLevers(draft.changes, work.pending)}
                effects={sensitivity.data?.levers ?? NO_EFFECTS}
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
                  Try Again
                </button>
              </p>
            )}
          </div>
          {draft !== null && (
            <div className="space-y-3">
              {results === null ? (
                <>
                  <div className="flex flex-wrap gap-2">{keepButtons}</div>
                  <p className="text-muted-foreground text-sm">No figures for this draft yet.</p>
                  {liveError !== null && <p className={AMBER_NOTE}>{liveError}</p>}
                </>
              ) : (
                <ScenarioResults
                  results={results}
                  state={state}
                  actions={keepButtons}
                  liveError={liveError}
                />
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
