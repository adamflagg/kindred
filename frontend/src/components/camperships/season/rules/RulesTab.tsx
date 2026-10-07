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
  ApiAidFieldChange,
  ApiAidRulesDocument,
  ApiAidRulesDraft,
  ApiAidRulesSection,
  ApiAidValidationIssue,
} from '../../../../types/api-types'
import { AMBER_NOTE } from '../../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../../QueryGuard'
import { aidHref } from '../../kit/asOf'
import { CS_BTN, CS_LINK, CS_META } from '../../kit/csType'
import { DefinitionNotes } from '../../kit/DefinitionNotes'
import { SEASON_CARD } from '../seasonStyles'
import { ApprovePanel, SeasonNotice } from '../SeasonChrome'
import { useSeasonChrome } from '../seasonChrome'
import { BudgetPointer } from './BudgetPointer'
import { CapacityForm } from './CapacityForm'
import { Chapter } from './Chapter'
import { ChapterBar } from './ChapterBar'
import { LeadLine, type LeadState } from './LeadLine'
import { sectionContent } from './rulesDraft'
import {
  CHAPTERS,
  GRID_PARTS,
  RULES_FOOTNOTES,
  chapterOfSection,
  chapterSummary,
  defaultOpen,
  parseOpenChapters,
  sectionsOf,
  toggleChapter,
} from './rulesLayout'
import {
  isRulesSection,
  rulesVocabulary,
  sectionIssues,
  statusWords,
  versionWords,
  type RulesNames,
  type StatusWords,
} from './rulesModel'
import { RulesSectionEditor } from './RulesSectionEditor'
import { SectionCard } from './SectionCard'
import { TierGridCard, type GridPart } from './TierGridCard'

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
          className={CS_BTN}
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

/** One section as a card shows it: its words, content (null: never approved), changes and issues. */
interface Shown {
  readonly section: ApiAidRulesSection
  readonly content: Record<string, unknown> | null
  readonly status: StatusWords
  readonly changes: readonly ApiAidFieldChange[]
  readonly issues: readonly ApiAidValidationIssue[]
}

const NOT_APPROVED: StatusWords = { pill: 'Not approved yet', tone: 'muted', meta: '', note: null }
const isGridPart = (section: ApiAidRulesSection): section is GridPart =>
  (GRID_PARTS as readonly string[]).includes(section)

const shownFromDraft = (draft: ApiAidRulesDraft): Shown[] =>
  draft.sections.map((s) => ({
    section: s.section,
    content: sectionContent(draft.document, s.section),
    status: statusWords(s.status, s.changes.length),
    changes: s.changes,
    issues: sectionIssues(draft.report.issues, s.section),
  }))

const shownFromApproved = (rules: ApiAidApprovedRules): Shown[] =>
  rules.sections.map((s) => ({
    section: s.section,
    content: s.content ?? null,
    status:
      s.content === null
        ? NOT_APPROVED
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
    changes: [],
    issues: [],
  }))

/** The approved sections as a document, for the grid's "was"; null while the tiers were never approved. */
const documentOfApproved = (rules: ApiAidApprovedRules | undefined): ApiAidRulesDocument | null => {
  if (rules === undefined) return null
  const entries = rules.sections.flatMap((s) =>
    s.content === null ? [] : [[s.section, s.content] as const]
  )
  return entries.some(([section]) => section === 'tiers')
    ? (Object.fromEntries(entries) as unknown as ApiAidRulesDocument)
    : null
}

function ChaptersBody({
  shown,
  draft,
  approvedRules,
  leadFor,
  finance,
  receipt,
  editing,
  setEditing,
  onNotice,
}: {
  shown: readonly Shown[]
  /** The draft read when this body shows the draft; null on the version in effect, a receipt, or the registrar's view. */
  draft: ApiAidRulesDraft | null
  approvedRules: ApiAidApprovedRules | undefined
  leadFor: (hold: 'edit' | 'approve' | null) => LeadState
  finance: boolean
  receipt: boolean
  editing: ApiAidRulesSection | null
  setEditing: (section: ApiAidRulesSection | null) => void
  onNotice: (notice: string | null) => void
}) {
  const year = useYear()
  const asOf = useAidAsOf()
  const chrome = useSeasonChrome()
  const sessions = useSessionNames()
  const [params, setSearchParams] = useSearchParams()
  const [inView, setInView] = useState<number | null>(null)
  const sectionParam = params.get('section')
  const budgetHref = aidHref('/aid/season/rounds-budget', { year, asOf })
  const grantsHref = aidHref('/aid/grants/grantors', { year, asOf })

  const contents = new Map(shown.map((s) => [s.section, s.content]))
  const statuses = new Map(shown.map((s) => [s.section, s.status]))
  const names: Omit<RulesNames, 'section'> = rulesVocabulary(
    (section) => contents.get(section) ?? undefined,
    sessions
  )
  const live = asOf.kind === 'live'
  const canEdit = finance && live && !receipt && !chrome.approving && editing === null

  // Open: the link's list, else the chapters holding a draft section or an issue; a named section's chapter, and the
  // chapter being edited, stay open.
  const explicit = parseOpenChapters(params.get('open'))
  const forced = [
    ...(editing === null ? [] : [chapterOfSection(editing)?.n]),
    ...(explicit === null && isRulesSection(sectionParam)
      ? [chapterOfSection(sectionParam)?.n]
      : []),
  ].filter((n): n is number => n !== undefined)
  const open = [...new Set([...(explicit ?? defaultOpen(draft)), ...forced])]

  const writeOpen = (list: readonly number[]) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('open', list.join(','))
        return next
      },
      { replace: true }
    )

  useEffect(() => {
    if (sectionParam === null) return
    const id =
      sectionParam === 'budget'
        ? 'budget-pointer'
        : isRulesSection(sectionParam)
          ? isGridPart(sectionParam)
            ? 'card-tiergrid'
            : `card-${sectionParam}`
          : null
    if (id !== null) document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [sectionParam])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const n = Number((entry.target as HTMLElement).dataset['chapter'])
        if (entry.isIntersecting && !Number.isNaN(n)) setInView(n)
      }
    })
    for (const chapter of CHAPTERS) {
      const element = document.getElementById(`chap-${String(chapter.n)}`)
      if (element !== null) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [])

  // The editor ends with the draft body (a 404 season, the switch to the version in effect), never carried to a later one;
  // a year change while the draft stays remounts the editor fresh instead (its key carries the year).
  const drafting = draft !== null
  useEffect(() => {
    if (!drafting) return undefined
    return () => setEditing(null)
  }, [drafting, setEditing])

  const jump = (n: number) => {
    if (!open.includes(n)) writeOpen([...open, n].sort((a, b) => a - b))
    document.getElementById(`chap-${String(n)}`)?.scrollIntoView({ block: 'start' })
  }

  const startEdit = (section: ApiAidRulesSection) => {
    onNotice(null)
    if (draft === null) {
      // On the version in effect, Edit… switches to the draft and opens the editor there.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('show')
          return next
        },
        { replace: true }
      )
    }
    setEditing(section)
  }

  const editor = (section: ApiAidRulesSection) =>
    draft !== null && editing === section ? (
      <RulesSectionEditor
        key={`${String(year)}:${section}`}
        section={section}
        draft={draft}
        names={{ ...names, section }}
        onDone={(saved) => {
          setEditing(null)
          if (saved !== null) {
            onNotice(
              saved.branched_from === null || saved.branched_from === undefined
                ? `Saved to the rules draft v${String(saved.version)}.`
                : `Saved as a new version, v${String(saved.version)}: the approved rules in use stay as they are until it is approved.`
            )
          }
        }}
      />
    ) : undefined

  const byPart = <T,>(by: (section: ApiAidRulesSection) => T) =>
    Object.fromEntries(GRID_PARTS.map((part) => [part, by(part)])) as Record<GridPart, T>
  const shownOf = (section: ApiAidRulesSection) => shown.find((s) => s.section === section)
  const inEffect = documentOfApproved(approvedRules)
  const approvedContent = (section: ApiAidRulesSection): Record<string, unknown> | null =>
    draft === null
      ? null
      : (approvedRules?.sections.find((s) => s.section === section)?.content ?? null)
  const document_ =
    draft?.document ?? (Object.fromEntries(contents) as unknown as ApiAidRulesDocument)
  const gridReady =
    GRID_PARTS.every((part) => contents.get(part) != null) && contents.get('programs') != null
  const dependentsMode = (): string | null => {
    const value = contents.get('income')?.['dependents_mode']
    return typeof value === 'string' ? value : null
  }
  const approvedVersion = approvedRules?.version ?? draft?.approved_version ?? null

  const sectionCard = (section: ApiAidRulesSection) => {
    const s = shownOf(section)
    if (s === undefined) return null
    return (
      <SectionCard
        key={section}
        section={section}
        content={s.content ?? {}}
        approved={approvedContent(section)}
        approvedVersion={approvedVersion}
        names={{ ...names, section }}
        status={s.status}
        changes={s.changes}
        issues={s.issues}
        canEdit={canEdit}
        onEdit={() => startEdit(section)}
        dependentsMode={dependentsMode()}
        grantsHref={grantsHref}
      >
        {s.content === null ? (
          <p className="text-muted-foreground mt-1 text-xs">
            Not approved yet: this section shows here once finance approves it.
          </p>
        ) : (
          editor(section)
        )}
      </SectionCard>
    )
  }

  const gridCard = () => {
    if (!gridReady) {
      return (
        <SectionCard
          key="tiergrid"
          section="tiers"
          content={{}}
          approved={null}
          names={{ ...names, section: 'tiers' }}
          status={statuses.get('tiers') ?? NOT_APPROVED}
          changes={[]}
          issues={[]}
          canEdit={false}
          onEdit={() => undefined}
        >
          <p className="text-muted-foreground mt-1 text-xs">
            Not approved yet: the tier grid shows here once finance approves its sections.
          </p>
        </SectionCard>
      )
    }
    const part = editing !== null && isGridPart(editing) ? editing : null
    const node = part === null ? undefined : editor(part)
    return (
      <TierGridCard
        key="tiergrid"
        document={document_}
        approved={inEffect}
        approvedVersion={approvedVersion}
        names={{ ...names, section: 'award_tables' }}
        statuses={statuses}
        changesBySection={byPart((section) => shownOf(section)?.changes ?? [])}
        issuesBySection={byPart((section) => shownOf(section)?.issues ?? [])}
        canEdit={canEdit}
        onEdit={startEdit}
        editing={part !== null && node !== undefined ? { part, node } : null}
      />
    )
  }

  const budget = shownOf('budget')
  const budgetDraft = draft?.sections.find((s) => s.section === 'budget')?.status.state === 'draft'
  const budgetErrors = (budget?.issues ?? []).filter((i) => i.severity === 'error').length

  return (
    <div className="space-y-3">
      <ChapterBar draft={draft} inView={inView} budgetHref={budgetHref} onJump={jump} />
      <LeadLine
        state={leadFor(editing !== null ? 'edit' : chrome.approving ? 'approve' : null)}
        onAll={(all) => writeOpen(all ? CHAPTERS.map((c) => c.n) : [])}
      />
      <ApprovePanel />
      <SeasonNotice />
      <div className="space-y-3">
        {(['Awards', 'Setup'] as const).map((group) => (
          <div key={group} className="space-y-3">
            <div className={`${CS_META} font-bold`}>{group}</div>
            {CHAPTERS.filter((c) => c.group === group).map((chapter) => {
              const sections = sectionsOf(chapter)
              const issues = sections.reduce((n, s) => n + (shownOf(s)?.issues.length ?? 0), 0)
              return (
                <Chapter
                  key={chapter.n}
                  chapter={chapter}
                  open={open.includes(chapter.n)}
                  summary={chapterSummary(chapter, statuses, issues)}
                  onToggle={() =>
                    writeOpen(toggleChapter(open, chapter.n).split(',').filter(Boolean).map(Number))
                  }
                  onJumpGrid={
                    chapter.key === 'awards'
                      ? () => {
                          if (!open.includes(1)) writeOpen([...open, 1].sort((a, b) => a - b))
                          document
                            .getElementById('card-tiergrid')
                            ?.scrollIntoView({ block: 'start' })
                        }
                      : undefined
                  }
                >
                  {chapter.cards.map((card) =>
                    card === 'tiergrid' ? (
                      gridCard()
                    ) : card === 'capacity' ? (
                      finance ? (
                        <CapacityForm key="capacity" />
                      ) : null
                    ) : (
                      sectionCard(card)
                    )
                  )}
                </Chapter>
              )
            })}
            {group === 'Setup' && (
              <BudgetPointer
                href={budgetHref}
                draftPill={
                  budgetDraft && budget !== undefined ? budget.status.pill.toLowerCase() : null
                }
                errors={budgetErrors}
              />
            )}
          </div>
        ))}
      </div>
      <DefinitionNotes notes={RULES_FOOTNOTES} />
    </div>
  )
}

/**
 * Season › Rules (spec §6; D39, D76): the rules document as seven chapters of section cards under a sticky chapter bar,
 * each card with its status and who approved it. Finance (`rules`) reads the rules draft with its changes, or the
 * approved version, and writes to the draft: edits a card, approves sections, or starts an empty season from last
 * year's rules. Everyone else reads the approved version only, read only (D76). `?version=` is a receipt's link to the
 * version that priced it; `?section=` opens (and scrolls to) a card; `?open=` lists the open chapters;
 * `?show=approved` is finance's view of what the registrar sees.
 */
export function RulesTab() {
  const year = useYear()
  const [params] = useSearchParams()
  const { hasPermission } = usePermissions()
  const href = useRulesHref()
  const finance = hasPermission(Permission.FINANCIAL_AID_RULES)
  const version = parseVersion(params.get('version'))
  const show =
    finance && version === null && params.get('show') !== 'approved' ? 'draft' : 'approved'
  // Finance reads both: the draft for its words and marks, the version in effect for each card's "was".
  const approved = useAidApprovedRules(version, { enabled: true })
  const draft = useAidRulesDraft({ enabled: finance && version === null })
  // The page's chrome owns the notice and the Approve panel (spec §4); Rules reads them.
  const chrome = useSeasonChrome()
  const setNotice = chrome.setNotice
  // The card being edited lives here so it survives the switch from the version in effect to the draft.
  const [editing, setEditing] = useState<ApiAidRulesSection | null>(null)

  const chrome_ = (
    <>
      <ApprovePanel />
      <SeasonNotice />
    </>
  )

  if (show === 'draft' && hasStatus(draft.error, 404) && !draft.data) {
    return (
      <div className="space-y-3">
        <LeadLine state={{ kind: 'none' }} onAll={() => undefined} />
        {chrome_}
        <NoRulesYet key={year} year={year} finance={finance} onNotice={setNotice} />
        {finance && <CapacityForm />}
      </div>
    )
  }

  const leadFor = (hold: 'edit' | 'approve' | null): LeadState => {
    if (version !== null) {
      const copies = (approved.data?.sections ?? []).filter((s) => s.content !== null)
      return {
        kind: 'receipt',
        words: versionWords(version, copies),
        backHref: href({ version: null }),
      }
    }
    if (finance && draft.data !== undefined) {
      return {
        kind: 'finance',
        show,
        draftVersion: draft.data.version,
        approvedVersion: draft.data.approved_version ?? null,
        hold,
        draftHref: href({ show: null }),
        approvedHref: href({ show: 'approved' }),
      }
    }
    return { kind: 'registrar', version: approved.data?.version ?? null }
  }

  if (show === 'draft') {
    return (
      <QueryGuard
        isLoading={draft.isLoading}
        error={draft.data ? null : draft.error}
        data={draft.data}
        label="the rules draft"
      >
        {(data) => (
          <ChaptersBody
            shown={shownFromDraft(data)}
            draft={data}
            approvedRules={approved.data}
            leadFor={leadFor}
            finance={finance}
            receipt={false}
            editing={editing}
            setEditing={setEditing}
            onNotice={setNotice}
          />
        )}
      </QueryGuard>
    )
  }
  if (hasStatus(approved.error, 404) && !approved.data) {
    return (
      <div className="space-y-3">
        {chrome_}
        <Missing
          text={
            version === null
              ? `No approved rules for ${String(year)} yet.`
              : `Rules v${String(version)} doesn't exist for ${String(year)}.`
          }
        >
          {version !== null && (
            <Link to={href({ version: null })} className={CS_LINK}>
              The Rules as They Price the Season ›
            </Link>
          )}
        </Missing>
      </div>
    )
  }
  return (
    <QueryGuard
      isLoading={approved.isLoading}
      error={approved.data ? null : approved.error}
      data={approved.data}
      label="the rules"
    >
      {(data) => (
        <ChaptersBody
          shown={shownFromApproved(data)}
          draft={null}
          approvedRules={data}
          leadFor={leadFor}
          finance={finance}
          receipt={version !== null}
          editing={editing}
          setEditing={setEditing}
          onNotice={setNotice}
        />
      )}
    </QueryGuard>
  )
}
