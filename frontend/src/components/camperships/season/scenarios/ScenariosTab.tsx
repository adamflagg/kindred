import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { Permission } from '../../../../constants/permissions'
import {
  useAidScenarioCompare,
  useAidScenarioTrail,
} from '../../../../hooks/camperships/useAidScenarioCompare'
import { useAidScenarioDraft } from '../../../../hooks/camperships/useAidScenarioDraft'
import {
  useAidScenarioSensitivity,
  useAidScenarios,
} from '../../../../hooks/camperships/useAidScenarios'
import { useYear } from '../../../../hooks/useCurrentYear'
import { usePermissions } from '../../../../hooks/usePermissions'
import { hasStatus } from '../../../../services/camperships/aidApi'
import type { ApiAidLeverEffect, ApiAidScenarioWorkspace } from '../../../../types/api-types'
import {
  AMBER_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  GROUP_HEADING,
  TAB_PILL_ACTIVE,
  TAB_PILL_IDLE,
} from '../../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../../QueryGuard'
import { campToday, formatLongDate, formatShortDate } from '../../kit/dates'
import { SEASON_CARD } from '../seasonStyles'
import { parseCodes, parseRequestSet, requestSetParam, toggleCode } from './compareModel'
import { KeptList } from './KeptList'
import { ScenarioCompare } from './ScenarioCompare'
import { ScenarioLevers } from './ScenarioLevers'
import { ScenarioResults } from './ScenarioResults'
import { ScenarioTrail } from './ScenarioTrail'
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

/**
 * The compare's and the trail's view state, in the URL (D15): `panel=trail`, `compare=A1,B2`,
 * `through=deadline|<date>` (D138), `last=1` (RPT-17), `tiers=1`, `trail_page=2`. Replaced, never
 * pushed: Back leaves Scenarios rather than stepping through every tick. `set` and `update` are stable
 * (the router's setter sits behind a ref), so a memo or effect that holds them never re-runs for a URL
 * change.
 */
function useScenarioView() {
  const [params, setParams] = useSearchParams()
  const setter = useRef(setParams)
  useEffect(() => {
    setter.current = setParams
  })
  // Every write copies the params the router holds at the call, so it keeps the other params (as_of,
  // year, the tab's own). The router reads its last render's params, so two writes in one tick would
  // lose one: no click or effect here writes twice in a tick.
  const update = useCallback((name: string, change: (previous: string | null) => string | null) => {
    setter.current(
      (previous) => {
        const next = new URLSearchParams(previous)
        const value = change(previous.get(name))
        if (value === null) next.delete(name)
        else next.set(name, value)
        return next
      },
      { replace: true }
    )
  }, [])
  const set = useCallback(
    (name: string, value: string | null) => update(name, () => value),
    [update]
  )
  const codesRaw = params.get('compare')
  const throughRaw = params.get('through')
  const codes = useMemo(() => parseCodes(codesRaw), [codesRaw])
  const requestSet = useMemo(() => parseRequestSet(throughRaw), [throughRaw])
  const page = Number(params.get('trail_page') ?? '1')
  return {
    panel: params.get('panel') === 'trail' ? ('trail' as const) : ('compare' as const),
    codes,
    requestSet,
    lastSeason: params.get('last') === '1',
    byTier: params.get('tiers') === '1',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageRaw: params.get('trail_page'),
    set,
    update,
  }
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
  const view = useScenarioView()
  const { hasPermission } = usePermissions()
  // Finance only, as every scenario route (D76): the registrar never fires either read.
  const canRules = hasPermission(Permission.FINANCIAL_AID_RULES)
  // A code in the URL that this year doesn't keep (a year switch, an old link) would only 404 the
  // read: it is left out of the request, dropped from the URL, and said once.
  const kept = useMemo(() => new Set(workspace.options.map((o) => o.code)), [workspace.options])
  const codes = useMemo(() => view.codes.filter((c) => kept.has(c)), [view.codes, kept])
  const gone = view.codes.filter((c) => !kept.has(c)).join(', ')
  const [droppedNote, setDroppedNote] = useState<string | null>(null)
  if (gone !== '' && gone !== droppedNote) setDroppedNote(gone)
  const { set: setView } = view
  useEffect(() => {
    if (gone !== '') setView('compare', codes.length === 0 ? null : codes.join(','))
  }, [gone, codes, setView])
  const compare = useAidScenarioCompare(codes, view.requestSet, view.lastSeason, {
    enabled: canRules && draft !== null && view.panel === 'compare',
  })
  const trail = useAidScenarioTrail(view.page, {
    enabled: canRules && draft !== null && view.panel === 'trail',
  })
  // A trail_page below 1, not a number, or past the last page reads as the nearest valid page.
  const lastPage = trail.data
    ? Math.max(1, Math.ceil(trail.data.total / trail.data.per_page))
    : null
  const { page: trailPage, pageRaw } = view
  useEffect(() => {
    if (pageRaw === null) return
    const wanted = lastPage !== null && trailPage > lastPage ? lastPage : trailPage
    const clean = wanted === 1 ? null : String(wanted)
    if (clean !== pageRaw) setView('trail_page', clean)
  }, [pageRaw, trailPage, lastPage, setView])
  // The code a fifth tick was refused for, said under the list until the next tick.
  const [refused, setRefused] = useState<string | null>(null)
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
                compare={{
                  ticked: new Set(codes),
                  onToggle: (code) => {
                    const outcome: { refused: string | null } = { refused: null }
                    view.update('compare', (previous) => {
                      const before = parseCodes(previous)
                      const next = toggleCode(before, code)
                      outcome.refused = next === before ? code : null
                      if (next === before) return previous
                      return next.length === 0 ? null : next.join(',')
                    })
                    setRefused(outcome.refused)
                    setDroppedNote(null)
                  },
                }}
              />
              {droppedNote !== null && (
                <p className={`${AMBER_NOTE} mx-3 mb-2`}>
                  {droppedNote.includes(',')
                    ? `${droppedNote} aren't kept in ${String(workspace.year)}, so they were left out of the compare.`
                    : `${droppedNote} isn't kept in ${String(workspace.year)}, so it was left out of the compare.`}
                </p>
              )}
              {refused !== null && (
                <p className={`${AMBER_NOTE} mx-3 mb-2`}>
                  {`Four are already ticked: untick one to compare ${refused}.`}
                </p>
              )}
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
              <div className="flex gap-1 print:hidden">
                <button
                  type="button"
                  className={view.panel === 'compare' ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
                  onClick={() => view.set('panel', null)}
                >
                  {`Compare (draft + ${String(codes.length)})`}
                </button>
                <button
                  type="button"
                  className={view.panel === 'trail' ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
                  onClick={() => view.set('panel', 'trail')}
                >
                  {trail.data
                    ? `Trail (${String(trail.data.total)} ${trail.data.total === 1 ? 'change' : 'changes'})`
                    : 'Trail'}
                </button>
              </div>
              {view.panel === 'compare' ? (
                <ScenarioCompare
                  compare={compare.data}
                  loading={compare.isLoading}
                  error={compare.data ? null : (compare.error?.message ?? null)}
                  stale={compare.isPlaceholderData}
                  requestSet={view.requestSet}
                  onRequestSet={(next) => view.set('through', requestSetParam(next))}
                  lastSeason={view.lastSeason}
                  onLastSeason={(on) => view.set('last', on ? '1' : null)}
                  byTier={view.byTier}
                  onByTier={(on) => view.set('tiers', on ? '1' : null)}
                />
              ) : (
                <QueryGuard
                  isLoading={trail.isLoading}
                  error={trail.data ? null : trail.error}
                  data={trail.data}
                  label="the trail"
                >
                  {(data) => (
                    <ScenarioTrail
                      trail={data}
                      current={draft.trail_id}
                      stale={trail.isPlaceholderData}
                      onLoad={(id) => void work.load({ trail_row: id })}
                      onPage={(next) => view.set('trail_page', next === 1 ? null : String(next))}
                    />
                  )}
                </QueryGuard>
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
