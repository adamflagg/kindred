import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { Permission } from '../../../../constants/permissions'
import { useAidScenarioFit } from '../../../../hooks/camperships/useAidPromotion'
import { useAidRenameOption } from '../../../../hooks/camperships/useAidRenameOption'
import { useAidScenarioCompare } from '../../../../hooks/camperships/useAidScenarioCompare'
import { useAidScenarioDraft } from '../../../../hooks/camperships/useAidScenarioDraft'
import { useAidScenarioPricing } from '../../../../hooks/camperships/useAidScenarioPricing'
import { useAidScenarios } from '../../../../hooks/camperships/useAidScenarios'
import { useYear } from '../../../../hooks/useCurrentYear'
import { usePermissions } from '../../../../hooks/usePermissions'
import { hasStatus } from '../../../../services/camperships/aidApi'
import type { ApiAidScenarioResults, ApiAidScenarioWorkspace } from '../../../../types/api-types'
import { QueryGuard } from '../../../QueryGuard'
import { CS_AMBER_NOTE, CS_CARD } from '../../kit/csType'
import { campToday, formatLongDate } from '../../kit/dates'
import { AidDefinitionNotes } from '../../shell/AidDefinitionNotes'
import { rulesVocabulary } from '../rules/rulesModel'
import { CompareTable, CompareTools } from './CompareTable'
import {
  columnChoices,
  columnParams,
  columnsFromView,
  compareQuery,
  defaultColumns,
  optionName,
  toggleColumn,
  withNewKeep,
  type ColumnKey,
} from './compareModel'
import {
  ROUND1_SECTIONS,
  changeWords,
  fromName,
  isStart,
  leadWords,
  keepFigureWords,
  nextLetter,
  nothingNewWords,
  parseView,
  pillWords,
  requestSetParam,
  pricedOnFigures,
  startEntries,
} from './controlsModel'
import { FitAnswer, FitToBudgetButton } from './FitToBudget'
import { MakeRulesDraftDialog } from './MakeRulesDraftDialog'
import { SandboxEquityCard } from './SandboxEquityCard'
import { SandboxIncomeCard } from './SandboxIncomeCard'
import { SandboxTierCard } from './SandboxTierCard'
import { bindingOf, changeCount } from './sandboxModel'
import { ScenarioControls } from './ScenarioControls'
import { builtOnWords } from './scenarioModel'
import { SCENARIO_PAGE_NOTES } from './scenarioNotes'
import { SpendTable } from './SpendTable'

const SURFACE = 'season-scenarios'

/**
 * The view's params (§S5 L; D15), replaced, never pushed: Back leaves Scenarios rather than stepping through every
 * click. Every write drops today's `trail_page` and `panel=trail`. The setter sits behind a ref, so a memo or
 * effect holding `write` never re-runs for a URL change.
 */
function useScenarioView() {
  const [params, setParams] = useSearchParams()
  const setter = useRef(setParams)
  useEffect(() => {
    setter.current = setParams
  })
  const search = params.toString()
  const view = useMemo(() => parseView(new URLSearchParams(search)), [search])
  const write = useCallback((changes: Readonly<Record<string, string | null>>) => {
    setter.current(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete('trail_page')
        if (next.get('panel') === 'trail') next.delete('panel')
        for (const [name, value] of Object.entries(changes)) {
          if (value === null) next.delete(name)
          else next.set(name, value)
        }
        return next
      },
      { replace: true }
    )
  }, [])
  return { view, write }
}

function Workspace({ workspace }: { workspace: ApiAidScenarioWorkspace }) {
  const { hasPermission } = usePermissions()
  const canEdit = hasPermission(Permission.FINANCIAL_AID_RULES)
  const { view, write } = useScenarioView()
  const work = useAidScenarioDraft(workspace)
  const rename = useAidRenameOption()
  const fit = useAidScenarioFit()
  const [fitAskedOn, setFitAskedOn] = useState<string | null | undefined>(undefined)
  const [fitAskedFresh, setFitAskedFresh] = useState(false)
  const [promoting, setPromoting] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const draft = workspace.draft
  const snapshot = workspace.snapshot
  // A posted round's lock in the real rules: Spend and Compare say its amounts stand. It never locks the sandbox
  // (owner, 2026-10-10: "scenarios sandbox should never lock anything unlike the real rules").
  const isLocked = (workspace.locked_sections ?? []).length > 0
  // Posted ▾ (owner, 2026-10-10: "as if nothing posted - all, regular - unposted"): a view setting in the URL that
  // prices every read as if nothing were posted. It never reaches the rules or a decision. Before any round posts the
  // two modes price alike, so there is no picker and every read is regular, whatever an old link says.
  const asIfUnposted = isLocked && view.asIfUnposted

  // A kept code in the URL this year doesn't hold (a year switch, an old link): left out, dropped, said once.
  const kept = useMemo(() => new Set(workspace.options.map((o) => o.code)), [workspace.options])
  const codes = view.codes.filter((code) => kept.has(code))
  const codesKey = codes.join(',')
  const gone = view.codes.filter((code) => !kept.has(code)).join(', ')
  const [droppedNote, setDroppedNote] = useState<string | null>(null)
  if (gone !== '' && gone !== droppedNote) setDroppedNote(gone)
  useEffect(() => {
    if (gone !== '') write({ compare: codesKey === '' ? null : codesKey })
  }, [gone, codesKey, write])

  const pricing = useAidScenarioPricing(
    work.pricedDocument,
    view.requestSet,
    snapshot?.id ?? null,
    asIfUnposted
  )
  const starting = useAidScenarioPricing(
    draft?.source_document ?? null,
    view.requestSet,
    snapshot?.id ?? null,
    asIfUnposted
  )
  // A refused read (a 422) keeps the last good figures on screen (§S5 E States).
  const fresh = pricing.data?.results ?? null
  const [lastGood, setLastGood] = useState<ApiAidScenarioResults | null>(null)
  if (fresh !== null && fresh !== lastGood) setLastGood(fresh)
  // The draft's stored figures are regular, on every request: a stand-in only for a regular read of all of them.
  const figures =
    fresh ??
    lastGood ??
    (view.requestSet.kind === 'all' && !asIfUnposted ? (draft?.results ?? null) : null)

  // The draft is a Compare column only while it holds changes no kept option has (N11). A `draft=1` still in the URL
  // after a keep is dropped here too, or Compare would show a column Columns ▾ no longer lists (plan review, minor 16).
  const sameAs = draft !== null && work.edits.size === 0 ? (draft.same_as ?? null) : null
  const keptSame = sameAs !== null && sameAs !== 'rules'
  const unkeptDraft =
    draft !== null && (draft.trail_id ?? null) !== null && draft.changes.length > 0 && !keptSame
  const wanted: ColumnKey[] = view.anyColumn
    ? columnsFromView({ ...view, codes })
    : defaultColumns(workspace)
  const checked = unkeptDraft ? wanted : wanted.filter((key) => key !== 'draft')
  const compare = useAidScenarioCompare(compareQuery(checked, view.requestSet, asIfUnposted), {
    enabled: canEdit && snapshot !== null && view.panel === 'compare',
  })

  if (draft === null) return null // never since PR 10: the workspace always holds a draft, recorded or not
  const source = draft.source_document ?? draft.document
  const binding = bindingOf({
    recorded: draft.document,
    source,
    edits: work.edits,
    canEdit,
    type: work.type,
    release: () => void work.release(),
  })
  const count = changeCount(binding.typed, source)
  const loaded = isStart(draft.from_code) ? null : draft.from_code
  const option = loaded === null ? undefined : workspace.options.find((o) => o.code === loaded)
  const promote =
    option !== undefined && count === 0 && option.promotable === true ? option.code : null
  const name = fromName(draft, workspace)
  const effectName =
    workspace.pricing_version === null
      ? `Rules draft v${String(workspace.rules_version)}`
      : `Rules v${String(workspace.pricing_version)}`
  const postedStands =
    isLocked &&
    !asIfUnposted &&
    (draft.differs_in ?? []).some((section) => ROUND1_SECTIONS.includes(section))
  // The vocabulary only: Compare reads each setting under its own section (Task 72; disagreement 13).
  const names = rulesVocabulary(
    (section) => (draft.document as unknown as Record<string, unknown>)[section]
  )
  const sourceNames = rulesVocabulary(
    (section) => (source as unknown as Record<string, unknown>)[section]
  )
  const priceOff = view.requestSet.kind !== 'all'
  const choices = columnChoices(workspace, unkeptDraft)
  const fitStale =
    fitAskedOn !== undefined &&
    (fitAskedOn !== (draft.trail_id ?? null) ||
      work.edits.size > 0 ||
      fitAskedFresh !== asIfUnposted)
  const recordedChanges = draft.changes.length
  const pricedOn = pricedOnFigures(figures, view.requestSet)

  return (
    <div className={view.panel === 'compare' ? 'space-y-2' : 'space-y-3'}>
      <MakeRulesDraftDialog
        code={promoting}
        names={names}
        sourceNames={sourceNames}
        onClose={() => setPromoting(null)}
      />
      <ScenarioControls
        panel={view.panel}
        compareCount={view.panel === 'compare' || view.anyColumn ? checked.length : 0}
        onPanel={(panel) => write({ panel: panel === 'compare' ? 'compare' : null })}
        pill={pillWords(snapshot)}
        lead={leadWords(snapshot)}
        nothingNew={work.nothingNew && snapshot !== null ? nothingNewWords(snapshot) : null}
        onUpdate={() => void work.update()}
        price={view.requestSet}
        onPrice={(set) => write({ through: requestSetParam(set) })}
        posted={isLocked ? (asIfUnposted ? 'none' : 'stands') : null}
        onPosted={(mode) => write({ unposted: mode === 'none' ? '1' : null })}
        start={startEntries(workspace)}
        fromCode={draft.from_code}
        loadedCode={loaded}
        builtOn={builtOnWords(draft, workspace)}
        chips={workspace.options.map((o) => ({
          code: o.code,
          name: optionName(o),
          loaded: o.code === loaded,
        }))}
        unkept={count}
        onLoad={(from) => void work.load(from)}
        canEdit={canEdit}
        onRename={(code, newName) => rename.mutate({ code, name: newName })}
        changes={changeWords(count, sameAs, workspace)}
        onDiscard={() => void work.discard()}
        keep={{
          // Nothing can be recorded before applications are held (disagreement 17), so nothing can be kept either.
          enabled: canEdit && snapshot !== null && count > 0 && !keptSame,
          prefill: draft.label,
          nextCode: nextLetter(workspace.options),
          figure: keepFigureWords(draft.results),
        }}
        onKeep={(keepName) =>
          void work.keep(keepName).then((code) => {
            // §S5 B: the new code joins Compare's columns, when Compare has columns and room for it.
            const next =
              code !== null && view.anyColumn
                ? withNewKeep(
                    checked,
                    code,
                    choices.map((c) => c.key)
                  )
                : null
            if (next !== null) write(columnParams(next))
          })
        }
        promote={promote}
        onPromote={setPromoting}
        compareTools={
          <CompareTools
            choices={choices}
            checked={checked}
            onToggle={(key) => {
              const result = toggleColumn(
                checked,
                key,
                choices.map((c) => c.key)
              )
              setRefused(result.refused)
              if (result.refused === null) write(columnParams(result.checked))
            }}
            byTier={view.byTier}
            onByTier={(on) => write({ tiers: on ? '1' : null })}
          />
        }
        refused={refused}
        notice={
          droppedNote === null
            ? null
            : droppedNote.includes(',')
              ? `${droppedNote} aren't kept in ${String(workspace.year)}, so they were left out of the compare.`
              : `${droppedNote} isn't kept in ${String(workspace.year)}, so it was left out of the compare.`
        }
        error={work.error ?? rename.error?.message ?? null}
      />
      {view.panel === 'sandbox' ? (
        <>
          <SpendTable
            draft={figures}
            from={starting.data?.results ?? null}
            stale={pricing.isPlaceholderData || (pricing.isFetching && fresh !== null)}
            error={pricing.error?.message ?? null}
            fromName={name}
            locked={isLocked}
            postedStands={postedStands}
            pricedOn={pricedOn}
            held={snapshot !== null}
          />
          <SandboxTierCard
            binding={binding}
            fitButton={
              canEdit ? (
                <FitToBudgetButton
                  disabled={priceOff || snapshot === null}
                  reason={
                    priceOff
                      ? 'Fit uses every application held'
                      : snapshot === null
                        ? 'Nothing is held yet'
                        : null
                  }
                  pending={fit.isPending}
                  moves={isLocked ? (asIfUnposted ? 'all' : 'unposted') : null}
                  onFit={() => {
                    setFitAskedOn(draft.trail_id ?? null)
                    setFitAskedFresh(asIfUnposted)
                    fit.mutate({ document: binding.typed, asIfUnposted })
                  }}
                />
              ) : null
            }
            fitAnswer={
              fit.data !== undefined ? (
                <FitAnswer
                  answer={fit.data}
                  stale={fitStale}
                  canUse={work.busy === null}
                  onUse={() => {
                    void work.adopt(fit.data.document, fitAskedOn ?? null).then((landed) => {
                      if (landed) fit.reset()
                    })
                  }}
                  onDismiss={() => fit.reset()}
                />
              ) : fit.error !== null ? (
                <p className={CS_AMBER_NOTE}>{fit.error.message}</p>
              ) : null
            }
          />
          <div className="grid items-start gap-3 lg:grid-cols-2">
            <SandboxEquityCard binding={binding} />
            <SandboxIncomeCard binding={binding} />
          </div>
        </>
      ) : (
        <CompareTable
          compare={compare.data}
          held={snapshot !== null}
          loading={compare.isLoading}
          error={compare.data === undefined ? (compare.error?.message ?? null) : null}
          stale={compare.isPlaceholderData}
          workspace={workspace}
          lastSeason={checked.includes('last_season')}
          requestSet={view.requestSet}
          byTier={view.byTier}
          locked={isLocked}
          draftName={`from ${name} · ${String(recordedChanges)} change${recordedChanges === 1 ? '' : 's'}`}
          effectName={effectName}
          names={names}
          canEdit={canEdit}
          printedOn={formatLongDate(campToday())}
          onPromote={setPromoting}
          onRename={(code, newName) => rename.mutate({ code, name: newName })}
        />
      )}
      <div className="print:hidden">
        {/* ONE list: the registry's four, then the page's Change colours (final mock's six, less Locked). */}
        <AidDefinitionNotes
          surface={SURFACE}
          extra={SCENARIO_PAGE_NOTES.map((note) => note.text)}
          boldTerm
        />
      </div>
    </div>
  )
}

/**
 * Season › Scenarios (Scenarios addendum; the final mock): finance's sandbox, built from the Rules tab's pieces,
 * with the Spend table on top, three cards, named flat kept options and Compare. A scenario never writes live
 * awards; a kept option reaches the rules only through Make It the Rules Draft. `rules` only: the tab is hidden
 * from everyone else (D76), and a past date shows today (parent §4's as-of sentence on the tab bar).
 */
export function ScenariosTab() {
  const year = useYear()
  const workspace = useAidScenarios()
  if (!workspace.data && (hasStatus(workspace.error, 404) || hasStatus(workspace.error, 422))) {
    return (
      <div className={`${CS_CARD} text-muted-foreground`}>
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
