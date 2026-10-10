import type { ReactNode } from 'react'

import { AidPicker } from '../../kit/AidPicker'
import { CS_AMBER_NOTE, CS_CARD_HEADING, CS_SMALL } from '../../kit/csType'
import { CHOICE_WORDS } from '../rules/rulesCards'
import { SandboxBox } from './SandboxBox'
import {
  DEPENDENTS,
  INCOME_MONEY,
  PRIOR_WEIGHT,
  boxLabel,
  cardProblems,
  currentYearWords,
  fixFirstWords,
  type SandboxBinding,
} from './sandboxModel'
import { CARD_SHELL } from './scenarioStyles'

const MODES = ['tier_shift', 'income_reduction', 'none'] as const

/** A kit key–value row (the mock's `.cf-kv.flush`): key 13px/600, the value with its box, a hairline under every row
 * but the last. A `<label>`, so the key names its box. */
const KV =
  'flex min-h-7 items-center gap-2.5 border-b border-b-[color-mix(in_oklab,var(--color-border)_75%,var(--color-card))] py-0.5 text-[13px] last:border-b-0 dark:border-b-[color-mix(in_oklab,var(--color-border)_80%,var(--color-card))]'
const KV_KEY = 'text-[13px] font-semibold whitespace-nowrap'
/** A group label (the mock's `.cf-kvg`): 12px/700 muted. */
const KV_GROUP = 'text-muted-foreground mt-2 mb-px text-xs font-bold'

function Kv({ name, children, aside }: { name: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <label className={KV}>
      <span className={KV_KEY}>{name}</span>
      <span className="whitespace-nowrap tabular-nums">{children}</span>
      {aside}
    </label>
  )
}

/** Income counting (§S5 F3): which years count, the expense and savings thresholds, and Dependents (owner 10-06:
 * "Dependents back on the Income counting card: YES"), in the Rules tab's own words, as kit key–value rows. Open after
 * a round posts too: the sandbox never locks (owner, 2026-10-10). */
export function SandboxIncomeCard({ binding }: { binding: SandboxBinding }) {
  const doc = binding.typed
  const lowers = doc.income.dependents_mode === 'income_reduction'
  const fixFirst = fixFirstWords(cardProblems(binding.problems, 'income'), doc)
  const dependentsWas = binding.was(DEPENDENTS)
  const money = (key: string, aside?: ReactNode) => (
    <Kv key={key} name={boxLabel(key, doc)} aside={aside}>
      <SandboxBox boxKey={key} label={boxLabel(key, doc)} width={84} unit="$" binding={binding} />
    </Kv>
  )
  return (
    <section data-card="sandbox-income" className={CARD_SHELL}>
      <h3 className={CS_CARD_HEADING}>Income counting</h3>
      {fixFirst !== null && <p className={CS_AMBER_NOTE}>{fixFirst}</p>}
      <div className={KV_GROUP}>Which years count</div>
      <Kv
        name={boxLabel(PRIOR_WEIGHT, doc)}
        aside={
          <span className={CS_SMALL} title="100% less the prior-year weight">
            current year <b className="text-foreground">{currentYearWords(doc)}</b>
          </span>
        }
      >
        <SandboxBox
          boxKey={PRIOR_WEIGHT}
          label={boxLabel(PRIOR_WEIGHT, doc)}
          width={64}
          unit="%"
          binding={binding}
        />
      </Kv>
      <div className={KV_GROUP}>Expenses, savings and dependents</div>
      {INCOME_MONEY.slice(0, 3).map((key) => money(key))}
      <Kv name="Dependents">
        <span title={dependentsWas ?? undefined}>
          <AidPicker
            size="field"
            label="Dependents"
            value={binding.value(DEPENDENTS)}
            disabled={!binding.canEdit}
            options={MODES.map((mode) => ({
              value: mode,
              label: CHOICE_WORDS['dependents_mode']?.[mode] ?? mode,
            }))}
            onChange={(mode) => {
              binding.type(DEPENDENTS, mode)
              binding.release()
            }}
          />
        </span>
      </Kv>
      {money(
        'income.per_dependent_reduction',
        !lowers && <span className={CS_SMALL}>not used now</span>
      )}
    </section>
  )
}
