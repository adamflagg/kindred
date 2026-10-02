import { useState } from 'react'
import { Link } from 'react-router'

import {
  useAidMakeRulesDraft,
  useAidPromotionPreview,
} from '../../../../hooks/camperships/useAidPromotion'
import { useAidAsOf } from '../../../../hooks/camperships/useAidAsOf'
import { useYear } from '../../../../hooks/useCurrentYear'
import { hasStatus } from '../../../../services/camperships/aidApi'
import { AMBER_NOTE, BUTTON_PRIMARY, BUTTON_SECONDARY } from '../../../admin/lodging/lodgingStyles'
import { Modal } from '../../../ui/Modal'
import { aidHref } from '../../kit/asOf'
import { PILL } from '../../kit/kitStyles'
import { SECTION_TITLES, changeWords } from '../rules/rulesModel'
import { allConfirmed, standingAcks, warningWords } from './promotionModel'

/**
 * "Make A1 the rules draft…" (spec §7.5; D39; rules.html A): lists each section the option changes,
 * old → new, and warns where it replaces someone's unapproved edit or undoes a later approval; each
 * such section is confirmed by a tick. The changed sections then go to approval on the Rules tab. If
 * the rules draft moved under the preview (G6's 409, or a re-edit), nothing is written: the preview
 * refreshes, and a tick whose warning changed no longer counts (Decision 21).
 */
export function MakeRulesDraftDialog({
  code,
  onClose,
}: {
  code: string | null
  onClose: () => void
}) {
  const year = useYear()
  const asOf = useAidAsOf()
  const preview = useAidPromotionPreview(code)
  const promote = useAidMakeRulesDraft()
  const [acks, setAcks] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [refused, setRefused] = useState<string | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const data = preview.data
  const close = () => {
    setAcks(new Map())
    setRefused(null)
    setDone(null)
    promote.reset()
    onClose()
  }

  const confirm = () => {
    if (code === null || data === undefined) return
    setRefused(null)
    promote.mutate(
      { code, body: { base_version: data.base_version, acknowledged: standingAcks(data, acks) } },
      {
        onSuccess: (draft) => setDone(draft.version),
        onError: (caught) =>
          setRefused(hasStatus(caught, 409) ? `${caught.message}.` : caught.message),
      }
    )
  }

  return (
    <Modal
      isOpen={code !== null}
      onClose={close}
      title={`Make ${code ?? ''} the rules draft`}
      size="lg"
      footer={
        done === null ? (
          <div className="flex justify-end gap-2">
            <button type="button" className={BUTTON_SECONDARY} onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className={BUTTON_PRIMARY}
              disabled={
                data === undefined ||
                promote.isPending ||
                !allConfirmed(data, acks) ||
                data.sections.length === 0
              }
              onClick={confirm}
            >
              {promote.isPending ? 'Making it the rules draft…' : 'Make it the rules draft'}
            </button>
          </div>
        ) : (
          <div className="flex justify-end">
            <button type="button" className={BUTTON_PRIMARY} onClick={close}>
              Done
            </button>
          </div>
        )
      }
    >
      {done !== null ? (
        <p className="text-sm" data-testid="promotion-done">
          {`${code ?? ''}'s changes are in the rules draft, v${String(done)}. Each changed section now needs approval: `}
          <Link
            to={aidHref('/aid/season/rules', { year, asOf })}
            className="text-primary hover:underline"
          >
            Rules ›
          </Link>
        </p>
      ) : preview.isLoading ? (
        <p className="text-muted-foreground text-sm">Looking at the changes…</p>
      ) : data === undefined ? (
        <p className={AMBER_NOTE}>{preview.error?.message ?? "Couldn't look at the changes."}</p>
      ) : (
        <div className="space-y-3 text-sm" data-testid="promotion-preview">
          <p>{`These settings from ${data.code} go into the rules draft (v${String(data.base_version)}). Each changed section then needs approval.`}</p>
          {data.sections.length === 0 && (
            <p className="text-muted-foreground">
              Nothing to change: the rules draft already reads as this option.
            </p>
          )}
          {data.sections.map((section) => {
            const warning = warningWords(section)
            const token = section.warning?.token ?? ''
            return (
              <div
                key={section.section}
                className="space-y-1"
                data-promotion-section={section.section}
              >
                <div className="flex items-center gap-2 font-medium">
                  {SECTION_TITLES[section.section]}
                  <span className={PILL.amber}>becomes Draft</span>
                </div>
                <ul className="text-xs">
                  {section.changes.map((change) => (
                    <li key={change.path.join('.')}>{changeWords(change)}</li>
                  ))}
                </ul>
                {warning !== null && (
                  <label className={`${AMBER_NOTE} flex items-center gap-1.5`}>
                    <input
                      type="checkbox"
                      checked={acks.get(section.section) === token}
                      onChange={(event) =>
                        setAcks((previous) => {
                          const next = new Map(previous)
                          if (event.target.checked) next.set(section.section, token)
                          else next.delete(section.section)
                          return next
                        })
                      }
                    />
                    {`${warning} Replace it.`}
                  </label>
                )}
              </div>
            )
          })}
          {data.unchanged.length > 0 && (
            <p className="text-muted-foreground text-xs">{`Unchanged: the other ${String(data.unchanged.length)} sections.`}</p>
          )}
          {refused !== null && (
            <p className={AMBER_NOTE} data-testid="promotion-refused">
              {`${refused} Nothing was changed. The list above is the rules draft as it is now: look again, then confirm.`}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
