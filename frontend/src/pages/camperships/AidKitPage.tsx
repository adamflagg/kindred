import { Palette } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  AidTable,
  type AidColumn,
  type AidGrouping,
} from '../../components/camperships/kit/AidTable'
import { STATUS_TONE } from '../../components/camperships/kit/kitStyles'
import { aidCsvFilename } from '../../components/camperships/kit/csv'
import { campToday } from '../../components/camperships/kit/dates'
import { DefRef, DefinitionNotes } from '../../components/camperships/kit/DefinitionNotes'
import { REASON_POLICY } from '../../components/camperships/kit/editor'
import {
  GALLERY_ROWS,
  REAL_INCENTIVE_ASK,
  REAL_REDUCE_COST_BASIS,
  REAL_ROUND2_CAP_NEGATIVE,
  type GalleryRow,
} from '../../components/camperships/kit/fixtures'
import { moneyCsv } from '../../components/camperships/kit/money'
import { Money, MoneyCompact, ReversedAmount } from '../../components/camperships/kit/MoneyText'
import { NeedsAttentionCell } from '../../components/camperships/kit/NeedsAttentionCell'
import {
  ConfirmationState,
  HouseholdChip,
  IdChip,
  OverPill,
  StatusPill,
} from '../../components/camperships/kit/Pills'
import { Receipt } from '../../components/camperships/kit/Receipt'
import { RequestEditor } from '../../components/camperships/kit/RequestEditor'
import { matchedId } from '../../components/camperships/kit/table'
import { AidPageBand } from '../../components/camperships/shell/AidPageBand'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card-lodge space-y-3 p-5">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      {children}
    </section>
  )
}

/** A receipt label with none of the lock facts (the server sends them nullable). */
const NO_LOCK = {
  locked_on: null,
  lock_source: null,
  ticked_by_name: null,
  decided_by_name: null,
} as const

const MONEY_EXAMPLES: ReadonlyArray<[string, ReactNode]> = [
  ['Nothing there yet', <Money key="a" value={null} />],
  ['A real zero', <Money key="b" value={0} />],
  ['Whole dollars', <Money key="c" value={1800} />],
  ['A figure with cents', <Money key="d" value={2399.72} />],
  ['A negative (red minus; never a plus on an increase)', <Money key="e" value={-1200} />],
  ['The Remaining line (thousands, toward zero)', <MoneyCompact key="f" value={153900} />],
  // §4.2, D119: over allocation on a pool, over budget only on the total.
  [
    'A pool over its allocation',
    <span key="h" className="inline-flex items-center gap-1.5">
      <Money value={-1200} /> <OverPill scope="pool" />
    </span>,
  ],
  [
    'The total over budget',
    <span key="i" className="inline-flex items-center gap-1.5">
      <Money value={-4800} /> <OverPill scope="total" />
    </span>,
  ],
  ['A reversed line', <ReversedAmount key="g" value={1500} reversedOn="2027-06-03" />],
]

const COLUMNS: Array<AidColumn<GalleryRow>> = [
  {
    key: 'family',
    header: 'Family',
    width: 110,
    pinned: true,
    value: (r) => r.family,
    searchable: true,
  },
  {
    key: 'camper',
    header: 'Camper',
    width: 130,
    pinned: true,
    value: (r) => r.camper,
    searchable: true,
    // D27: search an id and it shows as a chip under the name (try 1000006).
    render: (r, { query }) => {
      const id = matchedId([r.householdCmId, r.personCmId], query)
      return (
        <div>
          {r.camper}
          {id !== null && (
            <div>
              <IdChip id={id} />
            </div>
          )}
        </div>
      )
    },
  },
  { key: 'session', header: 'Session', width: 96, value: (r) => r.session },
  {
    key: 'decided',
    header: 'Decided',
    width: 90,
    align: 'right',
    value: (r) => r.decided,
    render: (r) => <Money value={r.decided} />,
    csv: (r) => moneyCsv(r.decided),
    total: (rows) => rows.reduce((sum, r) => sum + (r.decided ?? 0), 0),
  },
  {
    key: 'posted',
    header: 'Posted',
    width: 90,
    align: 'right',
    value: (r) => r.posted,
    render: (r) => <Money value={r.posted} />,
    csv: (r) => moneyCsv(r.posted),
    total: (rows) => rows.reduce((sum, r) => sum + (r.posted ?? 0), 0),
  },
  {
    key: 'confirmed',
    header: 'Confirmed by the ledger',
    width: 230,
    value: (r) => r.confirmation?.status ?? null,
    render: (r) => (r.confirmation ? <ConfirmationState confirmation={r.confirmation} /> : '—'),
  },
  {
    key: 'attention',
    header: 'Needs attention',
    flex: true,
    value: (r) => r.attention?.fact ?? null,
    render: (r, { highlighted }) => (
      <NeedsAttentionCell item={r.attention} highlighted={highlighted} />
    ),
  },
]

const GROUPINGS: Array<AidGrouping<GalleryRow>> = [
  {
    key: 'family',
    label: 'By family',
    groupOf: (r) => ({ id: String(r.householdCmId), heading: r.family }),
  },
  {
    key: 'reason',
    label: 'By reason',
    groupOf: (r) => ({
      id: r.attention?.pill ?? 'none',
      heading: r.attention?.pill ?? 'Nothing to do',
    }),
  },
]

/**
 * The finance kit on fictional data (Decision 3): the visual gate's reference until slice 1's
 * screens exist. Admin only, not in the nav, fixtures only (no fetches). Slice 1 deletes it.
 */
export default function AidKitPage() {
  const today = campToday()
  const attention = GALLERY_ROWS.find((r) => r.attention?.level === 'hold')?.attention ?? null
  return (
    <div className="space-y-4">
      <AidPageBand
        icon={Palette}
        title="Finance kit"
        subtitle="Fictional data · admin only · deleted when slice 1 ships"
      />

      <Section title="Money">
        <table className="text-sm">
          <tbody>
            {MONEY_EXAMPLES.map(([label, figure]) => (
              <tr key={label}>
                <td className="text-muted-foreground pr-6">{label}</td>
                <td className="text-right">{figure}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Pills and chips">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={STATUS_TONE.hold}>hold</StatusPill>
          <StatusPill tone={STATUS_TONE.note}>note</StatusPill>
          <StatusPill tone={STATUS_TONE.accepted}>accepted</StatusPill>
          <StatusPill tone={STATUS_TONE.round2}>Round 2</StatusPill>
          <StatusPill tone={STATUS_TONE.round3}>Round 3</StatusPill>
          <StatusPill tone={STATUS_TONE.cancelled}>cancelled</StatusPill>
          <HouseholdChip index={1} name="Johnson" />
          <HouseholdChip index={2} name="Garcia" />
          <HouseholdChip index={3} name="Chen" />
          <IdChip id={1000006} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {GALLERY_ROWS.flatMap((row) =>
            row.confirmation
              ? [<ConfirmationState key={row.id} confirmation={row.confirmation} />]
              : []
          )}
        </div>
      </Section>

      <Section title="Needs attention">
        <div className="w-96 space-y-2">
          <NeedsAttentionCell item={attention} highlighted={false} />
          <NeedsAttentionCell item={attention} highlighted />
        </div>
      </Section>

      <Section title="Table">
        <p className="text-muted-foreground text-xs">
          Click a row or use ↑/↓ to highlight it; the editor opens under it. Its result is a
          fixture: the real one comes from the server.
        </p>
        <AidTable<GalleryRow>
          rows={GALLERY_ROWS}
          columns={COLUMNS}
          rowKey={(r) => r.id}
          searchExtra={(r) => [r.householdCmId, r.personCmId]}
          groupings={GROUPINGS}
          csvFilename={aidCsvFilename({ surface: 'kit', view: 'gallery', season: 2027 })}
          footerLabel={(rows) => `${String(rows.length)} requests`}
          arrowKeys
          renderBelowHighlighted={(row, nav) => (
            <RequestEditor
              familyName={row.family}
              householdCmId={row.householdCmId}
              personCmId={row.personCmId}
              amountLabel="Round 2 ask"
              initialAmount={null}
              policy={REASON_POLICY.appeal_ask}
              today={today}
              preview={{
                status: 'ready',
                award: 1000,
                trace: REAL_INCENTIVE_ASK,
                stageChange: 'Needs an offer',
                shares: [
                  {
                    householdCmId: 1000001,
                    chip: 1,
                    householdName: 'Johnson',
                    pct: 60,
                    amount: 600,
                  },
                  {
                    householdCmId: 1000003,
                    chip: 2,
                    householdName: 'Garcia',
                    pct: 40,
                    amount: 400,
                  },
                ],
              }}
              onAmountChange={() => undefined}
              onSave={() => undefined}
              onMove={(direction) => (direction === 1 ? nav.next() : nav.previous())}
              onCancel={nav.close}
            />
          )}
        />
      </Section>

      <Section title="Receipt">
        <Receipt
          trace={REAL_INCENTIVE_ASK}
          label={{ ...NO_LOCK, kind: 'live', season: 2027, rules_version: 3 }}
        />
        <Receipt
          trace={REAL_ROUND2_CAP_NEGATIVE}
          label={{
            ...NO_LOCK,
            kind: 'locked',
            season: 2027,
            rules_version: 3,
            locked_on: '2027-03-09',
            lock_source: 'tick',
            ticked_by_name: 'Test User',
          }}
          folded
        />
        <Receipt
          trace={REAL_REDUCE_COST_BASIS}
          label={{ ...NO_LOCK, kind: 'reproduced', season: 2026, rules_version: 1 }}
          folded
        />
      </Section>

      <Section title="Definition notes">
        <p className="text-sm">
          Decided
          <DefRef n={1} /> · Posted
          <DefRef n={2} />
        </p>
        <DefinitionNotes
          notes={[
            {
              n: 1,
              text: 'Decided: the award Kindred computed or staff decided for the round; live until the round locks.',
            },
            { n: 2, text: "Posted: the round's Posted tick and the amount it locked." },
          ]}
        />
      </Section>
    </div>
  )
}
