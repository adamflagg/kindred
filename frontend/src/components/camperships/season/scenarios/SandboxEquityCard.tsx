import {
  CS_AMBER_NOTE,
  CS_CARD,
  CS_CARD_HEADING,
  CS_TABLE_CARD,
  CS_TD_CARD,
  CS_TH_CARD,
} from '../../kit/csType'
import { DefRef } from '../../kit/DefinitionNotes'
import { equityClasses, equityRows } from '../rules/rulesCards'
import { documentGroups } from '../rules/tierGrid'
import { SandboxBox } from './SandboxBox'
import { LockNoteView } from './SandboxTierCard'
import {
  cardProblems,
  classLabel,
  enabledKey,
  fixFirstWords,
  keyLocked,
  lockNote,
  weightKey,
  type SandboxBinding,
} from './sandboxModel'
import { PAGE_NOTE } from './scenarioNotes'
import { CHECK_CHANGED, LOCKED_CARD } from './scenarioStyles'

const TH_MID = CS_TH_CARD.replace('text-left', 'text-center')

/** Equity (§S5 F2): each criterion's Enabled and its weight per equity class. An unchecked criterion greys its row,
 * live, and keeps its weights. Counts when, Reads, Most tiers and Rounding stay on Rules (the cut). */
export function SandboxEquityCard({ binding }: { binding: SandboxBinding }) {
  const content = binding.typed.equity as unknown as Record<string, unknown>
  const before =
    binding.source === null ? null : (binding.source.equity as unknown as Record<string, unknown>)
  const note = lockNote('equity', binding.locked, binding.byRound)
  const classes = equityClasses(content, documentGroups(binding.typed))
  const fixFirst = fixFirstWords(cardProblems(binding.problems, 'equity'), binding.typed)
  return (
    <section
      data-card="sandbox-equity"
      className={`${CS_CARD} ${note !== null ? LOCKED_CARD : ''}`}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className={CS_CARD_HEADING}>Equity</h3>
        {note !== null && <LockNoteView text={note} />}
      </div>
      {fixFirst !== null && <p className={CS_AMBER_NOTE}>{fixFirst}</p>}
      <table className={`${CS_TABLE_CARD} mt-2`}>
        <thead>
          <tr>
            <th rowSpan={2} className={CS_TH_CARD}>
              Criterion
            </th>
            <th rowSpan={2} className={TH_MID}>
              Enabled
            </th>
            <th colSpan={classes.length} className={TH_MID}>
              Weight, by equity class
              <DefRef n={PAGE_NOTE.equityClass} />
            </th>
          </tr>
          <tr>
            {classes.map((cls) => (
              <th key={cls} className={TH_MID}>
                {classLabel(cls, binding.typed)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {equityRows(content, before).map((row) => {
            const key = enabledKey(row.index)
            return (
              <tr
                key={row.key}
                data-enabled={row.enabled ? '' : undefined}
                className={row.enabled ? '' : 'opacity-55'}
              >
                <td className={CS_TD_CARD}>{row.label}</td>
                <td className={`${CS_TD_CARD} text-center`}>
                  <input
                    type="checkbox"
                    aria-label={`${row.label} enabled`}
                    className={binding.was(key) !== null ? CHECK_CHANGED : ''}
                    checked={row.enabled}
                    disabled={!binding.canEdit || keyLocked(key, binding.locked)}
                    onChange={(event) => {
                      binding.type(key, String(event.target.checked))
                      binding.release()
                    }}
                  />
                </td>
                {classes.map((cls) => (
                  <td key={cls} className={`${CS_TD_CARD} text-center`}>
                    <SandboxBox
                      boxKey={weightKey(cls, row.key)}
                      label={`Weight · ${classLabel(cls, binding.typed)} · ${row.label}`}
                      width={46}
                      unit={null}
                      binding={binding}
                    />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
