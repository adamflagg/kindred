import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useAidSaveRulesSection } from '../../../hooks/camperships/useAidRulesWrites'
import { useOverlayEscape } from '../../../hooks/useOverlayEscape'
import { hasStatus } from '../../../services/camperships/aidApi'
import type { ApiAidRulesDraft } from '../../../types/api-types'
import { DefRef } from '../kit/DefinitionNotes'
import { formatMoney, toCents } from '../kit/money'
import { EditorActions, EditorField, EditorForm, EditorGrid } from '../kit/EditorLayout'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_FGRID_LABEL, CS_FIELD, CS_SMALL } from '../kit/csType'
import { savePrecondition } from './rules/precondition'
import { useSeasonChrome } from './seasonChrome'
import { planContent, planIssues, splitWords, type PlanPool, type TypedPlan } from './planModel'

const CONFLICT =
  'Someone else changed the rules draft since you opened this section. Nothing was saved; your typing is kept.'
const LOCKED =
  'Locked: the first approved budget total stands all season. The program shares still edit.'

/** The locked Total, drawn like every other figure ($1,111,000); read-only, so nothing parses back. */
function lockedTotalText(raw: string): string {
  const n = Number(raw)
  return raw.trim() === '' || !Number.isFinite(n) ? raw : formatMoney(n)
}

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
  inEffectTotal,
  onType,
  onClose,
}: {
  draft: ApiAidRulesDraft
  pools: readonly PlanPool[]
  opened: TypedPlan
  typed: TypedPlan
  shareNote: number | null
  /** The budget total in effect (the version posted rounds read), when the rules have one. */
  inEffectTotal: number | null
  onType: (plan: TypedPlan) => void
  onClose: () => void
}) {
  const save = useAidSaveRulesSection()
  const { setEditing } = useSeasonChrome()
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
  // Seeded from the draft, so "No change yet" would contradict a total in effect that differs: say which is which.
  const draftDiffers =
    inEffectTotal !== null && toCents(Number(opened.total)) !== toCents(inEffectTotal)
  const issues = planIssues(typed, opened, keys).map((issue) =>
    issue === 'No change yet' && draftDiffers
      ? `Draft v${String(draft.version)} · in effect ${formatMoney(inEffectTotal)}`
      : issue
  )
  const split = splitWords(typed, pools)
  // Owner 10-08: the first approved budget (or a posted round, 10-06 (b)) locks the TOTAL only; the shares stay editable all season. The server's flag, not
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
        onSuccess: () => {
          // No "Saved to the rules draft" line to dismiss (owner 10-08): the Rules switch names the draft.
          onClose()
        },
        onError: (caught) => setError(hasStatus(caught, 409) ? CONFLICT : caught.message),
      }
    )
  }
  const reason = [...issues, ...(error !== null ? [error] : [])].join(' · ')
  return (
    <EditorForm
      className="mt-2"
      side={
        <div className="space-y-1">
          {totalLocked && <p className={CS_SMALL}>{LOCKED}</p>}
          <p className={CS_SMALL}>{split ?? ''}</p>
        </div>
      }
      actions={
        <EditorActions>
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
          {reason !== '' && (
            <span className={`${CS_AMBER_NOTE} min-w-0 truncate`} title={reason}>
              {reason}
            </span>
          )}
        </EditorActions>
      }
    >
      <EditorGrid>
        <EditorField label="Total">
          <span className="inline-flex items-center gap-1.5">
            {totalLocked ? null : '$'}
            <input
              aria-label="Total"
              readOnly={totalLocked}
              className={`${CS_FIELD} w-[130px] text-right tabular-nums read-only:bg-stone-100 read-only:text-stone-500 dark:read-only:bg-stone-800 dark:read-only:text-stone-400`}
              value={totalLocked ? lockedTotalText(typed.total) : typed.total}
              onChange={(event) => onType({ ...typed, total: event.target.value })}
            />
            {totalLocked && (
              <Lock
                aria-label="Total locked"
                className="size-3.5 text-stone-500 dark:text-stone-400"
              />
            )}
          </span>
        </EditorField>
        <EditorField label={<>Program split{shareNote !== null && <DefRef n={shareNote} />}</>}>
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {pools.map((pool) => (
              <span key={pool.key} className="inline-flex items-center gap-1.5">
                <span className={CS_FGRID_LABEL}>{pool.label}</span>
                <input
                  aria-label={pool.label}
                  className={`${CS_FIELD} w-16 text-right tabular-nums`}
                  value={typed.shares[pool.key] ?? ''}
                  onChange={(event) =>
                    onType({
                      ...typed,
                      shares: { ...typed.shares, [pool.key]: event.target.value },
                    })
                  }
                />
                %
              </span>
            ))}
          </span>
        </EditorField>
      </EditorGrid>
    </EditorForm>
  )
}
