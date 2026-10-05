import { Download } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import type { ApiAidHouseholdPage } from '../../../types/api-types'
import { buildCsvContent, downloadCsv } from '../../../utils/csvExport'
import { withLinkLine } from '../kit/csv'
import { StatusPill } from '../kit/Pills'
import { historyLines, historyMeta } from './historyWords'
import {
  historyCsv,
  householdCsvName,
  multiHousehold,
  postingsCsv,
  type CsvTable,
} from './householdModel'
import {
  GrantsPostingsPanel,
  HistoryPanel,
  IncomePanel,
  LinksPanel,
  type CorrectRender,
} from './HouseholdSections'
import { HH_BUTTON, HH_CARD } from './householdStyles'
import { grantsTabMeta, incomeTabMeta, openFlagCount } from './incomeModel'

type TabKey = 'income' | 'grants' | 'links' | 'history'

const INCOME_HASH = '#income'

function download(table: CsvTable, filename: string) {
  downloadCsv(
    buildCsvContent(table.headers, withLinkLine(table.rows, window.location.href)),
    filename
  )
}

// The mock's .tab / .tm / .car / .tab.on (household-v2.html).
const TAB =
  'inline-flex items-baseline gap-2 whitespace-nowrap rounded-lg border px-2.5 py-[5px] text-[13.5px] font-bold text-foreground cursor-pointer'
const TAB_OFF = 'border-transparent hover:bg-muted/50'
const TAB_ON = 'bg-forest-100 border-forest-700/25 dark:bg-forest-900/40 dark:border-forest-300/30'
const TAB_META = 'text-muted-foreground text-xs font-normal'
const TAB_CARET = 'text-muted-foreground text-[11px] font-normal'
const SMALL_PILL = '[&>span]:text-[11px]'

/**
 * The default: a flag opens Income (as the receipt opens itself on a hold, D34), and so does a
 * link that lands at #income. Nothing else opens by itself: an Expected chip does not open Grants.
 */
function defaultTab(page: ApiAidHouseholdPage, hash: string): TabKey | null {
  return openFlagCount(page) > 0 || hash === INCOME_HASH ? 'income' : null
}

/**
 * The lower card: Income · Grants and postings · Linked households · History, one open at a time
 * (owner pick 10-04: income (e) "Tabs + exceptions"; N8–N10, O4, O9).
 *
 * ⚠ The open tab is component state, keyed by household, not a URL param, which CLAUDE.md asks of
 * tabs. Deliberately: the default is the data's (a flag opens Income; nothing open otherwise), and
 * `#income` already names the one place a link lands. A URL param would either pin a stale
 * default into every walked-to family's link or need clearing on each step of the queue walk.
 */
export function HouseholdTabs(props: {
  page: ApiAidHouseholdPage
  correct?: CorrectRender | undefined
  programNames: Readonly<Record<string, string>>
  hash: string
}) {
  // A new family (the queue walk's step) starts from its own default.
  return <Tabs key={props.page.household_cm_id} {...props} />
}

function Tabs({
  page,
  correct,
  programNames,
  hash,
}: {
  page: ApiAidHouseholdPage
  correct?: CorrectRender | undefined
  programNames: Readonly<Record<string, string>>
  hash: string
}) {
  // Frozen at the family's first render: a correction that resolves the flag does not shut the
  // panel under the hand that made it.
  const [open, setOpen] = useState<TabKey | null>(() => defaultTab(page, hash))
  const card = useRef<HTMLElement>(null)

  // A hash that turns to #income after load (a router navigation to this same page) opens Income;
  // adjusted while rendering, as React's "storing information from previous renders".
  const [seenHash, setSeenHash] = useState(hash)
  if (hash !== seenHash) {
    setSeenHash(hash)
    if (hash === INCOME_HASH) setOpen('income')
  }

  // "Enter the Income ↓" is a plain #income link: a second click on the same hash changes no
  // location, so the page listens for the click itself, opens Income and scrolls to it.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target.closest('a') : null
      const href = target?.getAttribute('href') ?? ''
      if (!href.endsWith(INCOME_HASH)) return
      setOpen('income')
      card.current?.scrollIntoView({ block: 'start' })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  const income = incomeTabMeta(page)
  const grants = grantsTabMeta(page)
  const lines = historyLines(page)
  const showLinks = multiHousehold(page) && page.links.length > 0

  const tabs: Array<{ key: TabKey; label: string; meta: ReactNode }> = [
    {
      key: 'income',
      label: 'Income',
      meta:
        income.flags > 0 ? (
          <StatusPill tone="amber">
            {income.flags === 1 ? '1 flag' : `${String(income.flags)} flags`}
          </StatusPill>
        ) : (
          <span className={TAB_META}>{income.words}</span>
        ),
    },
    {
      key: 'grants',
      label: 'Grants and postings',
      meta: (
        <>
          <span className={TAB_META}>
            {grants.words}
            {grants.expected > 0 ? ' ·' : ''}
          </span>
          {grants.expected > 0 && (
            <span className={SMALL_PILL}>
              <StatusPill tone="sky">{`${String(grants.expected)} expected`}</StatusPill>
            </span>
          )}
        </>
      ),
    },
    ...(showLinks
      ? [
          {
            key: 'links' as const,
            label: 'Linked households',
            meta: <span className={TAB_META}>{page.links.length}</span>,
          },
        ]
      : []),
    {
      key: 'history',
      label: 'History',
      meta: <span className={TAB_META}>{historyMeta(lines)}</span>,
    },
  ]

  return (
    <section id="income" ref={card} className={HH_CARD}>
      <div className="-mx-1.5 -my-1 flex flex-wrap items-stretch gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${TAB} ${open === t.key ? TAB_ON : TAB_OFF}`}
            onClick={() => setOpen(open === t.key ? null : t.key)}
          >
            {t.label} {t.meta}
            <span className={TAB_CARET}>{open === t.key ? '▴' : '▸'}</span>
          </button>
        ))}
        {open === 'grants' && (
          <span className="ml-auto self-center pr-1.5">
            <button
              type="button"
              className={HH_BUTTON}
              onClick={() => download(postingsCsv(page), householdCsvName(page, 'postings'))}
            >
              <Download className="h-3.5 w-3.5" />
              Download Postings
            </button>
          </span>
        )}
        {open === 'history' && lines.length > 0 && (
          <span className="ml-auto self-center pr-1.5">
            <button
              type="button"
              className={HH_BUTTON}
              onClick={() => download(historyCsv(page), householdCsvName(page, 'history'))}
            >
              <Download className="h-3.5 w-3.5" />
              Download History
            </button>
          </span>
        )}
      </div>
      {open !== null && (
        <div data-testid="tab-panel" className="border-border mt-2.5 border-t pt-2">
          {open === 'income' && <IncomePanel page={page} correct={correct} />}
          {open === 'grants' && <GrantsPostingsPanel page={page} programNames={programNames} />}
          {open === 'links' && <LinksPanel page={page} />}
          {open === 'history' && <HistoryPanel page={page} />}
        </div>
      )}
    </section>
  )
}
