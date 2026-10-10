import { CalendarCheck } from 'lucide-react'
import { useMemo } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router'

import { aidHref, type AidView } from '../../components/camperships/kit/asOf'
import { formatLongDate } from '../../components/camperships/kit/dates'
import { CS_SMALL } from '../../components/camperships/kit/csType'
import { Money } from '../../components/camperships/kit/MoneyText'
import { HistoryTab } from '../../components/camperships/season/HistoryTab'
import {
  RoundsBudgetCsv,
  RoundsBudgetScope,
  RoundsBudgetTab,
} from '../../components/camperships/season/RoundsBudgetTab'
import { isRulesSection } from '../../components/camperships/season/rules/rulesModel'
import { RulesTab } from '../../components/camperships/season/rules/RulesTab'
import { ScenariosTab } from '../../components/camperships/season/scenarios/ScenariosTab'
import {
  ApproveButton,
  ApprovePanel,
  SeasonChromeProvider,
  SeasonNotice,
  UnlockButton,
  UnlockPanel,
} from '../../components/camperships/season/SeasonChrome'
import { AidPageHead } from '../../components/camperships/shell/AidPageHead'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'
import { AidTabNav } from '../../components/camperships/shell/AidTabNav'
import { aidSection, resolveAidTab } from '../../config/aidNav'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useAidBudget } from '../../hooks/camperships/useAidBudget'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import type { ApiAidRulesSection } from '../../types/api-types'
import PermissionDeniedPage from '../PermissionDeniedPage'

const SEASON = aidSection('season')
const ROUNDS = 'rounds-budget'

/**
 * Rounds & budget's figures beside the band's title: the season's Allocated and the rules pricing
 * it. Mounted on that tab only, so no other tab shows a cached Allocated (Task 5 m2).
 */
function BudgetStats() {
  const data = useAidBudget().data
  if (data === undefined) return null
  return (
    <div className="text-forest-200 text-right text-xs sm:text-sm">
      <div>
        Allocated <Money value={data.total.total.allocated} className="font-semibold text-white" />
      </div>
      <div>
        {data.rules_version === null
          ? 'no approved rules yet'
          : `priced by rules v${String(data.rules_version)}`}
      </div>
    </div>
  )
}

/**
 * Season (spec §7; D44, D76): Rounds & budget · Scenarios · Rules · History, each a URL-held tab
 * (§3.6). Without `rules` Scenarios is hidden and Rules is the approved version, read only (D76).
 * Only Rounds & budget can show a past date (3c), so the band's figures are that tab's; the as-of
 * pill shows on every tab, because it covers the Remaining line, and the other tabs say they show
 * today when the link carries a date.
 */
export default function AidSeasonPage() {
  const { tab } = useParams()
  const [params] = useSearchParams()
  const { hasPermission } = usePermissions()
  const year = useYear()
  const asOf = useAidAsOf()
  const view = useMemo((): AidView => ({ year, asOf }), [year, asOf])
  const resolved = resolveAidTab(SEASON, tab, { hasPermission })
  if (resolved.kind === 'denied') return <PermissionDeniedPage />
  if (resolved.kind === 'first') {
    return <Navigate to={aidHref(`${SEASON.path}/${resolved.tab.slug}`, view)} replace />
  }
  const slug = resolved.tab?.slug ?? ROUNDS
  const onRounds = slug === ROUNDS
  const onRules = slug === 'rules'
  const onScenarios = slug === 'scenarios'
  const sectionParam = params.get('section')
  // The section the Approve panel checks first: on Rules, the URL's section, else income (Rules' first card, the fallback
  // RulesTab used before chapters); elsewhere the budget (Rounds & budget's edits).
  const approveSection: ApiAidRulesSection = onRules
    ? isRulesSection(sectionParam)
      ? sectionParam
      : 'income'
    : 'budget'
  const right = (
    <>
      {onRounds && <RoundsBudgetScope />}
      {!onRounds && asOf.kind === 'past' && (
        <span className={CS_SMALL}>
          {`This tab shows today. Rounds & budget can show ${formatLongDate(asOf.date)}.`}
        </span>
      )}
      <ApproveButton />
      <UnlockButton />
      {onRounds && <RoundsBudgetCsv />}
    </>
  )

  return (
    <SeasonChromeProvider section={approveSection} tab={slug}>
      <div className="space-y-2.5 print:font-sans">
        {/* Scenarios prints as the compare alone: its band and tab strip stay off the paper. */}
        <div className={onScenarios ? 'print:hidden' : undefined}>
          <AidPageHead
            band={
              <AidPageBand
                icon={CalendarCheck}
                title={SEASON.label}
                subtitle={`Season ${String(year)}`}
                // A past date covers the Remaining line on every tab, so its pill shows on every tab (I6).
                asOf={asOf}
                stats={onRounds ? <BudgetStats /> : undefined}
              />
            }
            tabs={<AidTabNav section={SEASON} tabs={resolved.tabs} view={view} right={right} />}
          />
        </div>
        {/* Rules puts the panel and the notice under its own lead line (spec §6.2 B). */}
        {!onRules && <ApprovePanel />}
        {!onRules && <UnlockPanel />}
        {!onRules && <SeasonNotice />}
        {onRounds && <RoundsBudgetTab />}
        {slug === 'history' && <HistoryTab />}
        {onRules && <RulesTab />}
        {onScenarios && <ScenariosTab />}
      </div>
    </SeasonChromeProvider>
  )
}
