import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Permission } from '../../../../constants/permissions'
import { useAidAsOf } from '../../../../hooks/camperships/useAidAsOf'
import { useAidApprovedRules, useAidRulesDraft } from '../../../../hooks/camperships/useAidRules'
import { useAidStartRulesFromLastYear } from '../../../../hooks/camperships/useAidRulesWrites'
import { useAidSessionNames } from '../../../../hooks/camperships/useAidSessionNames'
import { useYear } from '../../../../hooks/useCurrentYear'
import { usePermissions } from '../../../../hooks/usePermissions'
import { hasStatus } from '../../../../services/camperships/aidApi'
import type {
  ApiAidApprovedRules,
  ApiAidRulesDraft,
  ApiAidRulesSection,
} from '../../../../types/api-types'
import {
  AMBER_NOTE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  TAB_PILL_ACTIVE,
  TAB_PILL_IDLE,
} from '../../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../../QueryGuard'
import { aidHref } from '../../kit/asOf'
import { NEGATIVE_INK } from '../../kit/aidStyles'
import { PILL } from '../../kit/kitStyles'
import { SEASON_CARD } from '../seasonStyles'
import { RulesSectionList, type SectionItem } from './RulesSectionList'
import {
  SECTION_TITLES,
  changeWords,
  isRulesSection,
  issueWords,
  rulesVocabulary,
  sectionIssues,
  statusWords,
  versionWords,
  type RulesNames,
  type StatusWords,
} from './rulesModel'
import { ApprovePanel, SeasonNotice } from '../SeasonChrome'
import { useSeasonChrome } from '../seasonChrome'
import { CapacityForm } from './CapacityForm'
import { sectionContent } from './rulesDraft'
import { RulesSectionEditor } from './RulesSectionEditor'
import { SectionView } from './SectionView'

const PATH = '/aid/season/rules'

function parseVersion(raw: string | null): number | null {
  return raw !== null && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
}

/**
 * The rules reads are live (neither takes an as_of), but links here keep the page's as-of, so the
 * band's pill and the Remaining line keep the date the link carried (I6, D15).
 */
function useRulesHref() {
  const year = useYear()
  const asOf = useAidAsOf()
  const [params] = useSearchParams()
  return (extra: Record<string, string | null>) => {
    const kept: Record<string, string> = {}
    for (const key of ['show', 'version', 'section']) {
      const value = key in extra ? extra[key] : params.get(key)
      if (value !== null && value !== undefined) kept[key] = value
    }
    return aidHref(PATH, { year, asOf }, kept)
  }
}

/** A section served from another version than the header's says so (the server fills a never-priced section from its newest copy). */
function fromVersion(
  words: StatusWords,
  sectionVersion: number | null,
  headerVersion: number | null
): StatusWords {
  if (sectionVersion === null || headerVersion === null || sectionVersion === headerVersion) {
    return words
  }
  const from = `from v${String(sectionVersion)}`
  return { ...words, meta: words.meta === '' ? from : `${words.meta} · ${from}` }
}

/** The season's session names, for the rules' session ids (#15); undefined until they load. */
function useSessionNames() {
  return useAidSessionNames(useYear())
}

function ApprovedBody({
  rules,
  selected,
  version,
}: {
  rules: ApiAidApprovedRules
  selected: ApiAidRulesSection
  version: number | null
}) {
  const href = useRulesHref()
  const sessions = useSessionNames()
  const names: RulesNames = {
    section: selected,
    ...rulesVocabulary(
      (section) => rules.sections.find((s) => s.section === section)?.content,
      sessions
    ),
  }
  // A section never approved has no copy in this version: it says so in the list, not here.
  const copies = rules.sections.filter((s) => s.content !== null)
  const items: SectionItem[] = rules.sections.map((s) => ({
    section: s.section,
    status:
      s.content === null
        ? { pill: 'Not approved yet', tone: 'muted', meta: '' }
        : fromVersion(
            statusWords(
              {
                state: s.state,
                approved_by: s.approved_by,
                approved_at: s.approved_at,
                note: s.note,
                locked_at: s.locked_at,
              },
              null
            ),
            s.version,
            rules.version
          ),
    issues: null,
  }))
  const chosen = rules.sections.find((s) => s.section === selected)
  const item = items.find((i) => i.section === selected)
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        {version !== null
          ? `${versionWords(version, copies)}. `
          : rules.version === null
            ? 'No version prices the season yet: each section shows its newest approved copy. '
            : `The approved rules: v${String(rules.version)} prices the season. `}
        {version !== null && (
          <Link to={href({ version: null })} className="text-primary hover:underline">
            The Rules as They Price the Season ›
          </Link>
        )}
      </p>
      <div className="grid gap-3 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <RulesSectionList
          items={items}
          selected={selected}
          hrefOf={(section) => href({ section })}
        />
        <section className={`${SEASON_CARD} space-y-2 p-4`} data-testid="rules-section">
          <h2 className="flex flex-wrap items-center gap-2 font-semibold">
            {SECTION_TITLES[selected]}
            {item && <span className={PILL[item.status.tone]}>{item.status.pill}</span>}
            {item && item.status.meta !== '' && (
              <span className="text-muted-foreground text-xs font-normal">{item.status.meta}</span>
            )}
          </h2>
          {chosen?.content ? (
            <SectionView content={chosen.content} names={names} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Not approved yet: this section shows here once finance approves it.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

/** A draft every section of which is approved, and so the version pricing the season. */
const pricesTheSeason = (draft: ApiAidRulesDraft) => draft.approved_version === draft.version
type Mode = 'read' | 'edit'

function DraftBody({
  draft,
  selected,
  finance,
  mode,
  onMode: setMode,
  onNotice,
}: {
  draft: ApiAidRulesDraft
  selected: ApiAidRulesSection
  finance: boolean
  mode: Mode
  onMode: (mode: Mode) => void
  onNotice: (notice: string | null) => void
}) {
  const href = useRulesHref()
  const year = useYear()
  const chrome = useSeasonChrome()
  const sessions = useSessionNames()
  const names: RulesNames = {
    section: selected,
    ...rulesVocabulary((section) => draft.document[section], sessions),
  }
  // The mode lives in the tab so its pills can hold; it ends with this body (a year change, a
  // 404 season, ?show=approved), never carried to a later one.
  useEffect(() => () => setMode('read'), [setMode])
  const items: SectionItem[] = draft.sections.map((s) => ({
    section: s.section,
    status: statusWords(s.status, s.changes.length),
    issues: issueWords(s.errors, s.warnings),
  }))
  const chosen = draft.sections.find((s) => s.section === selected)
  const item = items.find((i) => i.section === selected)
  const issues = sectionIssues(draft.report.issues, selected)
  const editing = mode === 'edit'
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground text-sm">
          {draft.approved_version === null
            ? `Rules draft v${String(draft.version)}: no version prices the season yet.`
            : pricesTheSeason(draft)
              ? `${versionWords(
                  draft.version,
                  draft.sections.map((s) => s.status)
                )}: it prices the season.`
              : `Rules draft v${String(draft.version)}, against the approved v${String(draft.approved_version)}.`}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <RulesSectionList
          items={items}
          selected={selected}
          hrefOf={(section) => href({ section })}
          locked={editing}
        />
        <section className={`${SEASON_CARD} space-y-2 p-4`} data-testid="rules-section">
          <h2 className="flex flex-wrap items-center gap-2 font-semibold">
            {SECTION_TITLES[selected]}
            {item && <span className={PILL[item.status.tone]}>{item.status.pill}</span>}
            {item && item.status.meta !== '' && (
              <span className="text-muted-foreground text-xs font-normal">{item.status.meta}</span>
            )}
            {finance && mode === 'read' && !chrome.approving && (
              <button
                type="button"
                className={`${BUTTON_SECONDARY} ml-auto`}
                onClick={() => {
                  onNotice(null)
                  setMode('edit')
                }}
              >
                Edit…
              </button>
            )}
          </h2>
          {editing ? (
            <RulesSectionEditor
              key={`${String(year)}:${selected}`}
              section={selected}
              draft={draft}
              names={names}
              onDone={(saved) => {
                setMode('read')
                if (saved !== null) {
                  onNotice(
                    saved.branched_from === null || saved.branched_from === undefined
                      ? `Saved to the rules draft v${String(saved.version)}.`
                      : `Saved as a new version, v${String(saved.version)}: the approved rules in use stay as they are until it is approved.`
                  )
                }
              }}
            />
          ) : (
            <>
              {chosen && chosen.changes.length > 0 && (
                <ul className="text-sm" data-testid="section-changes">
                  {chosen.changes.map((change) => (
                    <li key={change.path.join('.')}>{changeWords(change, names)}</li>
                  ))}
                </ul>
              )}
              {issues.length > 0 && (
                <ul className="space-y-0.5" data-testid="section-issues">
                  {issues.map((issue, index) => (
                    <li
                      key={`${issue.code}:${issue.path}:${String(index)}`}
                      className={
                        issue.severity === 'error' ? `text-xs ${NEGATIVE_INK}` : AMBER_NOTE
                      }
                    >
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}
              <SectionView
                content={sectionContent(draft.document, selected)}
                changes={chosen?.changes ?? []}
                names={names}
              />
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/** A season with no rules: finance can start it from last season's (§7.5), every section a draft. */
function NoRulesYet({
  year,
  finance,
  onNotice,
}: {
  year: number
  finance: boolean
  onNotice: (notice: string | null) => void
}) {
  const start = useAidStartRulesFromLastYear()
  const [error, setError] = useState<string | null>(null)
  return (
    <div className={`${SEASON_CARD} text-muted-foreground space-y-2`}>
      <p>{`No rules for ${String(year)} yet.`}</p>
      {finance && (
        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={start.isPending}
          onClick={() => {
            setError(null)
            start.mutate(undefined, {
              onSuccess: (created) =>
                onNotice(
                  [
                    `Started ${String(year)} from ${String(year - 1)}'s rules: every section is a draft until approved.`,
                    ...(created.report.issues ?? [])
                      .filter((issue) => issue.severity === 'warning')
                      .map((issue) => issue.message),
                  ].join(' ')
                ),
              onError: (caught) => setError(caught.message),
            })
          }}
        >
          {start.isPending ? 'Starting…' : `Start ${String(year)} from ${String(year - 1)}'s Rules`}
        </button>
      )}
      {error !== null && <p className={AMBER_NOTE}>{error}</p>}
    </div>
  )
}

function Missing({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className={`${SEASON_CARD} text-muted-foreground space-y-1 p-4`}>
      <p>{text}</p>
      {children}
    </div>
  )
}

/**
 * Season › Rules (spec §7.5; D39, D76; rules.html A, season-access.html C): the rules document
 * section by section, each with its status and who approved it. Finance (`rules`) reads the rules
 * draft with its changes, or the approved version, and writes to the draft: edits a section,
 * approves sections, or starts an empty season from last year's rules. Everyone else reads the
 * approved version only, read only (D76). `?version=` is a receipt's link to the version that priced it; `?section=` opens
 * a section; `?show=approved` is finance's view of what the registrar sees.
 */
export function RulesTab() {
  const year = useYear()
  const [params] = useSearchParams()
  const { hasPermission } = usePermissions()
  const href = useRulesHref()
  const finance = hasPermission(Permission.FINANCIAL_AID_RULES)
  const version = parseVersion(params.get('version'))
  const sectionParam = params.get('section')
  const selected: ApiAidRulesSection = isRulesSection(sectionParam) ? sectionParam : 'income'
  const show =
    finance && version === null && params.get('show') !== 'approved' ? 'draft' : 'approved'
  const approved = useAidApprovedRules(version, { enabled: show === 'approved' })
  const draft = useAidRulesDraft({ enabled: show === 'draft' })
  // The page's chrome owns the notice and the Approve panel (spec §4); Rules reads them.
  const chrome = useSeasonChrome()
  const setNotice = chrome.setNotice
  // Lifted so the tab's own pills hold still while an edit or an approval is open.
  const [mode, setMode] = useState<Mode>('read')
  const holding = show === 'draft' && (mode !== 'read' || chrome.approving)
  // A fully approved draft prices the season, so its pill names the version, not a draft (#23).
  const draftPill =
    draft.data === undefined
      ? 'Rules draft'
      : pricesTheSeason(draft.data)
        ? `Rules v${String(draft.data.version)}`
        : `Rules draft v${String(draft.data.version)}`

  return (
    <div className="space-y-3">
      {finance && version === null && (
        <div className="flex flex-wrap items-center gap-1">
          {holding ? (
            // While an edit or approval is open the tab's own pills hold still too (Decision 15).
            <>
              <span className={TAB_PILL_ACTIVE}>{draftPill}</span>
              <span className={TAB_PILL_IDLE}>Approved</span>
              <span className="text-muted-foreground px-2 text-xs">
                {mode === 'edit' ? 'Save or cancel the edit first.' : 'Approve or cancel first.'}
              </span>
            </>
          ) : (
            <>
              <Link
                to={href({ show: null })}
                replace
                className={show === 'draft' ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
              >
                {draftPill}
              </Link>
              <Link
                to={href({ show: 'approved' })}
                replace
                className={show === 'approved' ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
              >
                Approved
              </Link>
            </>
          )}
        </div>
      )}
      <ApprovePanel />
      <SeasonNotice />
      {show === 'draft' ? (
        hasStatus(draft.error, 404) && !draft.data ? (
          <NoRulesYet key={year} year={year} finance={finance} onNotice={setNotice} />
        ) : (
          <QueryGuard
            isLoading={draft.isLoading}
            error={draft.data ? null : draft.error}
            data={draft.data}
            label="the rules draft"
          >
            {(data) => (
              <DraftBody
                draft={data}
                selected={selected}
                finance={finance}
                mode={mode}
                onMode={setMode}
                onNotice={setNotice}
              />
            )}
          </QueryGuard>
        )
      ) : hasStatus(approved.error, 404) && !approved.data ? (
        <Missing
          text={
            version === null
              ? `No approved rules for ${String(year)} yet.`
              : `Rules v${String(version)} doesn't exist for ${String(year)}.`
          }
        >
          {version !== null && (
            <Link to={href({ version: null })} className="text-primary hover:underline">
              The Rules as They Price the Season ›
            </Link>
          )}
        </Missing>
      ) : (
        <QueryGuard
          isLoading={approved.isLoading}
          error={approved.data ? null : approved.error}
          data={approved.data}
          label="the rules"
        >
          {(data) => <ApprovedBody rules={data} selected={selected} version={version} />}
        </QueryGuard>
      )}
      {finance && <CapacityForm />}
    </div>
  )
}
