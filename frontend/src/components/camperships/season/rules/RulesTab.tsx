import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Permission } from '../../../../constants/permissions'
import { useAidAsOf } from '../../../../hooks/camperships/useAidAsOf'
import { useAidApprovedRules, useAidRulesDraft } from '../../../../hooks/camperships/useAidRules'
import { useAidSessionNames } from '../../../../hooks/camperships/useAidSessionNames'
import { useYear } from '../../../../hooks/useCurrentYear'
import { usePermissions } from '../../../../hooks/usePermissions'
import { hasStatus } from '../../../../services/camperships/aidApi'
import type {
  ApiAidApprovedRules,
  ApiAidRulesDraft,
  ApiAidRulesSection,
} from '../../../../types/api-types'
import { AMBER_NOTE, TAB_PILL_ACTIVE, TAB_PILL_IDLE } from '../../../admin/lodging/lodgingStyles'
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
import { CapacityForm } from './CapacityForm'
import { sectionContent } from './rulesDraft'
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

function DraftBody({ draft, selected }: { draft: ApiAidRulesDraft; selected: ApiAidRulesSection }) {
  const href = useRulesHref()
  const sessions = useSessionNames()
  const names: RulesNames = {
    section: selected,
    ...rulesVocabulary((section) => draft.document[section], sessions),
  }
  const items: SectionItem[] = draft.sections.map((s) => ({
    section: s.section,
    status: statusWords(s.status, s.changes.length),
    issues: issueWords(s.errors, s.warnings),
  }))
  const chosen = draft.sections.find((s) => s.section === selected)
  const item = items.find((i) => i.section === selected)
  const issues = sectionIssues(draft.report.issues, selected)
  return (
    <div className="space-y-2">
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
                  className={issue.severity === 'error' ? `text-xs ${NEGATIVE_INK}` : AMBER_NOTE}
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
        </section>
      </div>
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
 * draft with its changes, or the approved version; everyone else reads the approved version only,
 * read only (D76). `?version=` is a receipt's link to the version that priced it; `?section=` opens
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

  return (
    <div className="space-y-3">
      {finance && version === null && (
        <div className="flex gap-1">
          <Link
            to={href({ show: null })}
            replace
            className={show === 'draft' ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
          >
            {draft.data === undefined
              ? 'Rules draft'
              : pricesTheSeason(draft.data)
                ? `Rules v${String(draft.data.version)}`
                : `Rules draft v${String(draft.data.version)}`}
          </Link>
          <Link
            to={href({ show: 'approved' })}
            replace
            className={show === 'approved' ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
          >
            Approved
          </Link>
        </div>
      )}
      {show === 'draft' ? (
        hasStatus(draft.error, 404) && !draft.data ? (
          <Missing text={`No rules for ${String(year)} yet.`} />
        ) : (
          <QueryGuard
            isLoading={draft.isLoading}
            error={draft.data ? null : draft.error}
            data={draft.data}
            label="the rules draft"
          >
            {(data) => <DraftBody draft={data} selected={selected} />}
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
