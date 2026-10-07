import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useAidSaveRulesSection } from '../../../hooks/camperships/useAidRulesWrites'
import { useOverlayEscape } from '../../../hooks/useOverlayEscape'
import { hasStatus } from '../../../services/camperships/aidApi'
import type { ApiAidRulesDraft } from '../../../types/api-types'
import { DefRef } from '../kit/DefinitionNotes'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_INPUT, CS_LABEL, CS_SMALL } from '../kit/csType'
import { savePrecondition } from './rules/precondition'
import { useSeasonChrome } from './seasonChrome'
import { planContent, planIssues, splitWords, type PlanPool, type TypedPlan } from './planModel'

const CONFLICT =
  'Someone else changed the rules draft since you opened this section. Nothing was saved; your typing is kept.'
const LOCKED =
  'Locked: a posted round read it. Saving may start a new version of it. Posted amounts stand.'

/**
 * Edit Plan… (spec §5.2 B): the budget's total and program split, inline in the Budget card. Every card previews the
 * typed plan; Save writes the rules draft's budget section (prices nothing until approved). Finance, live only.
 */
export function EditPlan({
  draft,
  pools,
  opened,
  typed,
  shareNote,
  onType,
  onClose,
}: {
  draft: ApiAidRulesDraft
  pools: readonly PlanPool[]
  opened: TypedPlan
  typed: TypedPlan
  shareNote: number | null
  onType: (plan: TypedPlan) => void
  onClose: () => void
}) {
  const save = useAidSaveRulesSection()
  const { setNotice, setEditing } = useSeasonChrome()
  // Approve… waits while the plan is open: it would approve the draft without the typing under it.
  useEffect(() => {
    setEditing(true)
    return () => setEditing(false)
  }, [setEditing])
  const [error, setError] = useState<string | null>(null)
  useOverlayEscape(true, () => {
    if (!save.isPending) onClose()
  })
  const keys = pools.map((p) => p.key)
  const issues = planIssues(typed, opened, keys)
  const split = splitWords(typed, pools)
  // Owner 10-06 (b): a posted round locks the TOTAL only; the shares stay editable all season. The server's flag, not
  // the section's state: a shares save lifts the section's lock in the version it writes, and the total stays locked.
  const totalLocked = draft.budget_total_locked === true
  const onSave = () => {
    setError(null)
    let fingerprint: string
    try {
      fingerprint = savePrecondition(draft, 'budget').expected_fingerprint
    } catch {
      setError("Couldn't send this save: reload the rules and try again.")
      return
    }
    save.mutate(
      {
        section: 'budget',
        body: {
          base_version: draft.version,
          content: planContent(typed, pools),
          expected_fingerprint: fingerprint,
        },
      },
      {
        onSuccess: (saved) => {
          onClose()
          setNotice(`Saved to the rules draft v${String(saved.version)} · Approve on the tab bar`)
        },
        onError: (caught) => setError(hasStatus(caught, 409) ? CONFLICT : caught.message),
      }
    )
  }
  return (
    <div className="mt-2 space-y-1.5 border-t border-dashed border-amber-300 pt-2 dark:border-amber-800">
      {totalLocked && <p className={CS_SMALL}>{LOCKED}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <label className="inline-flex items-center gap-1.5">
          <span className={CS_LABEL}>Total</span> $
          <input
            aria-label="Total"
            readOnly={totalLocked}
            className={`${CS_INPUT} w-[110px] text-right tabular-nums read-only:bg-stone-100 read-only:text-stone-500 dark:read-only:bg-stone-800 dark:read-only:text-stone-400`}
            value={typed.total}
            onChange={(event) => onType({ ...typed, total: event.target.value })}
          />
          {totalLocked && (
            <Lock
              aria-label="Total locked"
              className="size-3.5 text-stone-500 dark:text-stone-400"
            />
          )}
        </label>
        <span className={CS_LABEL}>
          Program split{shareNote !== null && <DefRef n={shareNote} />}
        </span>
        {pools.map((pool) => (
          <label key={pool.key} className="inline-flex items-center gap-1.5">
            {pool.label}
            <input
              aria-label={pool.label}
              className={`${CS_INPUT} w-16 text-right tabular-nums`}
              value={typed.shares[pool.key] ?? ''}
              onChange={(event) =>
                onType({ ...typed, shares: { ...typed.shares, [pool.key]: event.target.value } })
              }
            />
            %
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={CS_SMALL}>{split ?? ''}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {issues.length > 0 && <span className={CS_AMBER_NOTE}>{issues.join(' · ')}</span>}
          {error !== null && <span className={CS_AMBER_NOTE}>{error}</span>}
          <button
            type="button"
            className={CS_BTN}
            disabled={issues.length > 0 || save.isPending}
            onClick={onSave}
          >
            {save.isPending ? 'Saving…' : 'Save to Rules Draft'}
          </button>
          <button type="button" className={CS_BTN2} disabled={save.isPending} onClick={onClose}>
            Cancel
          </button>
          <span className={CS_SMALL}>Esc cancels</span>
        </span>
      </div>
    </div>
  )
}
