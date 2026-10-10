import { CS_AMBER_NOTE, CS_CARD_HEADING } from '../../kit/csType'
import {
  RG_TABLE_FIT,
  RG_TD_GROUP_NUM,
  RG_TD_MID,
  RG_TD_NAME,
  RG_TD_NUM,
  RG_TH,
  RG_TH_GROUP_NUM,
  RG_TH_MID,
  RG_TH_NUM,
  RG_WRAP_FIT,
} from '../rules/gridStyles'
import { equityClasses, equityRows } from '../rules/rulesCards'
import { documentGroups } from '../rules/tierGrid'
import { SandboxBox } from './SandboxBox'
import {
  cardProblems,
  classLabel,
  enabledKey,
  fixFirstWords,
  poolHeadLabel,
  weightKey,
  type SandboxBinding,
} from './sandboxModel'
import { TITLE_WORDS } from './scenarioNotes'
import { CARD_SHELL, CHECK_CHANGED, GROUP_HEAD } from './scenarioStyles'

/** The kit's check (`.cf-ck`): the forest accent, 13px; greyed only without `rules`, as the boxes are. */
const CHECK =
  'accent-primary size-[13px] cursor-pointer align-middle disabled:cursor-not-allowed disabled:opacity-50'

/** Equity (§S5 F2): each criterion's Enabled and its weight per equity class, the columns named as the pools (owner
 * B34). An unchecked criterion greys its row, live, and keeps its weights. Counts when, Reads, Most tiers and Rounding
 * stay on Rules (the cut). */
export function SandboxEquityCard({ binding }: { binding: SandboxBinding }) {
  const content = binding.typed.equity as unknown as Record<string, unknown>
  const before =
    binding.source === null ? null : (binding.source.equity as unknown as Record<string, unknown>)
  const classes = equityClasses(content, documentGroups(binding.typed))
  const fixFirst = fixFirstWords(cardProblems(binding.problems, 'equity'), binding.typed)
  return (
    <section data-card="sandbox-equity" className={CARD_SHELL}>
      <h3 className={CS_CARD_HEADING}>Equity</h3>
      {fixFirst !== null && <p className={CS_AMBER_NOTE}>{fixFirst}</p>}
      <div className={RG_WRAP_FIT}>
        <table className={RG_TABLE_FIT}>
          <thead>
            <tr>
              <th colSpan={2} className={RG_TH} />
              <th colSpan={classes.length} className={GROUP_HEAD} title={TITLE_WORDS.equityClass}>
                Weight, by equity class
              </th>
            </tr>
            <tr>
              <th className={RG_TH}>Criterion</th>
              <th className={RG_TH_MID}>Enabled</th>
              {classes.map((cls, i) => (
                <th key={cls} className={i === 0 ? RG_TH_GROUP_NUM : RG_TH_NUM}>
                  {poolHeadLabel(cls, binding.typed)}
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
                  <td className={RG_TD_NAME}>{row.label}</td>
                  <td className={RG_TD_MID}>
                    <input
                      type="checkbox"
                      aria-label={`${row.label} enabled`}
                      className={`${CHECK} ${binding.was(key) !== null ? CHECK_CHANGED : ''}`}
                      checked={row.enabled}
                      disabled={!binding.canEdit}
                      onChange={(event) => {
                        binding.type(key, String(event.target.checked))
                        binding.release()
                      }}
                    />
                  </td>
                  {classes.map((cls, i) => (
                    <td key={cls} className={i === 0 ? RG_TD_GROUP_NUM : RG_TD_NUM}>
                      <SandboxBox
                        boxKey={weightKey(cls, row.key)}
                        label={`Weight · ${classLabel(cls, binding.typed)} · ${row.label}`}
                        width={64}
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
      </div>
    </section>
  )
}
