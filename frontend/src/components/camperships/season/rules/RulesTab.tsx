import { Link, useSearchParams } from 'react-router'

import { Permission } from '../../../../constants/permissions'
import { useAidApprovedRules, useAidRulesDraft } from '../../../../hooks/camperships/useAidRules'
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
import { PILL } from '../../kit/kitStyles'
import { SEASON_CARD } from '../seasonStyles'
import { RulesSectionList, type SectionItem } from './RulesSectionList'
import {
  SECTION_TITLES,
  changeWords,
  isRulesSection,
  issueWords,
  sectionIssues,
  statusWords,
} from './rulesModel'
import { sectionContent } from './rulesDraft'
import { SectionView } from './SectionView'

const PATH = '/aid/season/rules'

function parseVersion(raw: string | null): number | null {
  return raw !== null && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
}

/** The rules carry no past date: links here keep the season and drop any as-of. */
function useRulesHref() {
  const year = useYear()
  const [params] = useSearchParams()
  return (extra: Record<string, string | null>) => {
    const kept: Record<string, string> = {}
    for (const key of ['show', 'version', 'section']) {
      const value = key in extra ? extra[key] : params.get(key)
      if (value !== null && value !== undefined) kept[key] = value
    }
    return aidHref(PATH, { year, asOf: { kind: 'live' } }, kept)
  }
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
  const items: SectionItem[] = rules.sections.map((s) => ({
    section: s.section,
    status:
      s.content === null
        ? { pill: 'Not approved yet', tone: 'muted', meta: '' }
        : statusWords(
            {
              state: s.state,
              approved_by: s.approved_by,
              approved_at: s.approved_at,
              note: s.note,
              locked_at: s.locked_at,
            },
            null
          ),
    issues: null,
  }))
  const chosen = rules.sections.find((s) => s.section === selected)
  const item = items.find((i) => i.section === selected)
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        {version !== null
          ? `Rules v${String(version)}, the version a receipt names. `
          : rules.version === null
            ? 'No version prices the season yet: each section shows its newest approved copy. '
            : `The approved rules: v${String(rules.version)} prices the season. `}
        {version !== null && (
          <Link to={href({ version: null })} className="text-primary hover:underline">
            The rules as they price the season ›
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
            <SectionView content={chosen.content} />
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

function DraftBody({ draft, selected }: { draft: ApiAidRulesDraft; selected: ApiAidRulesSection }) {
  const href = useRulesHref()
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
          : draft.approved_version === draft.version
            ? `Rules v${String(draft.version)}: this draft is the version pricing the season.`
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
                <li key={change.path.join('.')}>{changeWords(change)}</li>
              ))}
            </ul>
          )}
          {issues.length > 0 && (
            <ul className="space-y-0.5" data-testid="section-issues">
              {issues.map((issue) => (
                <li
                  key={`${issue.code}:${issue.path}`}
                  className={
                    issue.severity === 'error'
                      ? 'text-sm text-red-700 dark:text-red-400'
                      : AMBER_NOTE
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
          />
        </section>
      </div>
    </div>
  )
}

function Missing({ text }: { text: string }) {
  return <div className={`${SEASON_CARD} text-muted-foreground p-4`}>{text}</div>
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
  const draftVersion = draft.data?.version ?? null

  return (
    <div className="space-y-3">
      {finance && version === null && (
        <div className="flex gap-1">
          <Link
            to={href({ show: null })}
            replace
            className={show === 'draft' ? TAB_PILL_ACTIVE : TAB_PILL_IDLE}
          >
            {draftVersion === null ? 'Rules draft' : `Rules draft v${String(draftVersion)}`}
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
              : `Rules v${String(version)} of ${String(year)} has no approved sections.`
          }
        />
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
    </div>
  )
}
