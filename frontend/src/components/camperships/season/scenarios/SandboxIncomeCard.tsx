import {
  CS_AMBER_NOTE,
  CS_CARD,
  CS_CARD_TITLE,
  CS_FLABEL,
  CS_META,
  CS_PANEL_HEAD,
  CS_SELECT,
  CS_SMALL,
} from '../../kit/csType'
import { DefRef } from '../../kit/DefinitionNotes'
import { CHOICE_WORDS } from '../rules/rulesCards'
import { SandboxBox } from './SandboxBox'
import { LockNoteView } from './SandboxTierCard'
import {
  DEPENDENTS,
  INCOME_MONEY,
  PRIOR_WEIGHT,
  cardProblems,
  currentYearWords,
  fixFirstWords,
  keyLabel,
  keyLocked,
  lockNote,
  type SandboxBinding,
} from './sandboxModel'
import { PAGE_NOTE } from './scenarioNotes'
import { LOCKED_CARD, WAS_INK } from './scenarioStyles'

const MODES = ['tier_shift', 'income_reduction', 'none'] as const

/** Income counting (§S5 F3): which years count, the expense and savings thresholds, and Dependents (owner 10-06:
 * "Dependents back on the Income counting card: YES"), in the Rules tab's own words. Before the lock only. */
export function SandboxIncomeCard({ binding }: { binding: SandboxBinding }) {
  const doc = binding.typed
  const note = lockNote('income', binding.locked, binding.byRound)
  const lowers = doc.income.dependents_mode === 'income_reduction'
  const fixFirst = fixFirstWords(cardProblems(binding.problems, 'income'), doc)
  const dependentsWas = binding.was(DEPENDENTS)
  const row = (key: string, width: 96 | 64, muted = false) => (
    <label
      key={key}
      className={`${CS_FLABEL} flex items-baseline gap-1.5 ${muted ? 'text-muted-foreground' : ''}`}
    >
      {keyLabel(key, doc)}{' '}
      <SandboxBox
        boxKey={key}
        label={keyLabel(key, doc)}
        width={width}
        unit="$"
        binding={binding}
      />
      {muted && <span className={CS_META}>not used now</span>}
    </label>
  )
  return (
    <section
      data-card="sandbox-income"
      className={`${CS_CARD} ${note !== null ? LOCKED_CARD : ''} space-y-1.5`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className={CS_CARD_TITLE}>Income counting</h3>
        {note !== null && <LockNoteView text={note} />}
      </div>
      {fixFirst !== null && <p className={CS_AMBER_NOTE}>{fixFirst}</p>}
      <div className={CS_PANEL_HEAD}>Which years count</div>
      <label className={`${CS_FLABEL} flex items-baseline gap-1.5`}>
        {keyLabel(PRIOR_WEIGHT, doc)}{' '}
        <SandboxBox
          boxKey={PRIOR_WEIGHT}
          label={keyLabel(PRIOR_WEIGHT, doc)}
          width={64}
          unit="%"
          binding={binding}
        />
      </label>
      <p className={CS_SMALL}>
        Read-only
        <DefRef n={PAGE_NOTE.readOnly} /> Current-year weight{' '}
        <b className="text-foreground">{currentYearWords(doc)}</b>
      </p>
      <div className={CS_PANEL_HEAD}>Expenses, savings and dependents</div>
      {INCOME_MONEY.slice(0, 3).map((key) => row(key, 96))}
      <label className={`${CS_FLABEL} flex items-baseline gap-1.5`}>
        Dependents
        <select
          aria-label="Dependents"
          className={CS_SELECT}
          value={binding.value(DEPENDENTS)}
          disabled={!binding.canEdit || keyLocked(DEPENDENTS, binding.locked)}
          onChange={(event) => {
            binding.type(DEPENDENTS, event.target.value)
            binding.release()
          }}
        >
          {MODES.map((mode) => (
            <option key={mode} value={mode}>
              {CHOICE_WORDS['dependents_mode']?.[mode] ?? mode}
            </option>
          ))}
        </select>
        {dependentsWas !== null && <span className={`${CS_META} ${WAS_INK}`}>{dependentsWas}</span>}
      </label>
      {row('income.per_dependent_reduction', 64, !lowers)}
    </section>
  )
}
