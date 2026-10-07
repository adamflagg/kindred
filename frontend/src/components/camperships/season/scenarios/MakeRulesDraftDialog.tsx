import { useState } from 'react'
import { Link } from 'react-router'

import {
  useAidMakeRulesDraft,
  useAidPromotionPreview,
} from '../../../../hooks/camperships/useAidPromotion'
import { useAidAsOf } from '../../../../hooks/camperships/useAidAsOf'
import { useYear } from '../../../../hooks/useCurrentYear'
import { hasStatus } from '../../../../services/camperships/aidApi'
import { Modal } from '../../../ui/Modal'
import { aidHref } from '../../kit/asOf'
import { CS_AMBER_NOTE, CS_BODY, CS_BTN, CS_BTN2, CS_SMALL } from '../../kit/csType'
import { PILL } from '../../kit/kitStyles'
import { SECTION_TITLES, changeWords, type RulesVocabulary } from '../rules/rulesModel'
import { settingWords } from './compareModel'
import { allConfirmed, standingAcks, warningWords } from './promotionModel'

/**
 * "Make A1 the Rules Draft…" (spec §7.5; D39; rules.html A): lists each section the option changes,
 * old → new, and warns where it replaces someone's unapproved edit or undoes a later approval; each
 * such section is confirmed by a tick. The changed sections then go to approval on the Rules tab. If
 * the rules draft moved under the preview (G6's 409, or a re-edit), nothing is written: the preview
 * refreshes, and a tick whose warning changed no longer counts (Decision 21).
 */
export function MakeRulesDraftDialog({
  code,
  names,
  onClose,
}: {
  code: string | null
  /** The rules vocabulary, so a table or class key reads as the program's or pool's label it shares. */
  names: RulesVocabulary
  onClose: () => void
}) {
  const year = useYear()
  const asOf = useAidAsOf()
  const preview = useAidPromotionPreview(code)
  const promote = useAidMakeRulesDraft()
  const [acks, setAcks] = useState<ReadonlyMap<string, string>>(() => new Map())
  // A refusal (4xx, in the server's words) wrote nothing; any other failure may have.
  const [failure, setFailure] = useState<{
    readonly kind: 'refused' | 'unknown'
    readonly message: string
  } | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const data = preview.data
  const rulesHref = aidHref('/aid/season/rules', { year, asOf })
  const close = () => {
    // A running write can't be walked away from: a reset would drop its answer (the write still lands).
    if (promote.isPending) return
    setAcks(new Map())
    setFailure(null)
    setDone(null)
    promote.reset()
    onClose()
  }

  const confirm = () => {
    if (code === null || data === undefined) return
    setFailure(null)
    promote.mutate(
      { code, body: { base_version: data.base_version, acknowledged: standingAcks(data, acks) } },
      {
        onSuccess: (draft) => setDone(draft.version),
        onError: (caught) => {
          const message = caught.message.replace(/\.?$/, '.')
          setFailure({
            kind:
              hasStatus(caught, 404) || hasStatus(caught, 409) || hasStatus(caught, 422)
                ? 'refused'
                : 'unknown',
            message,
          })
        },
      }
    )
  }

  return (
    <Modal
      isOpen={code !== null}
      onClose={close}
      closeDisabled={promote.isPending}
      title={`Make ${code ?? ''} the rules draft`}
      size="lg"
      footer={
        done === null ? (
          <div className="flex justify-end gap-2">
            <button type="button" className={CS_BTN2} disabled={promote.isPending} onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className={CS_BTN}
              disabled={
                data === undefined ||
                promote.isPending ||
                !allConfirmed(data, acks) ||
                data.sections.length === 0
              }
              onClick={confirm}
            >
              {promote.isPending ? 'Making It the Rules Draft…' : 'Make It the Rules Draft'}
            </button>
          </div>
        ) : (
          <div className="flex justify-end">
            <button type="button" className={CS_BTN} onClick={close}>
              Done
            </button>
          </div>
        )
      }
    >
      {done !== null ? (
        <p className={CS_BODY} data-testid="promotion-done">
          {`${code ?? ''}'s changes are in the rules draft, v${String(done)}. Each changed section now needs approval: `}
          <Link to={rulesHref} className="text-primary hover:underline">
            Rules ›
          </Link>
          , or Approve… on the tab bar.
        </p>
      ) : preview.isLoading ? (
        <p className={CS_SMALL}>Looking at the changes…</p>
      ) : data === undefined ? (
        <p className={CS_AMBER_NOTE}>{preview.error?.message ?? "Couldn't look at the changes."}</p>
      ) : (
        <div className={`${CS_BODY} space-y-3`} data-testid="promotion-preview">
          <p>{`These settings from ${data.code} go into the rules draft. Each changed section then needs approval.`}</p>
          {data.sections.length === 0 && (
            <p className={CS_SMALL}>
              Nothing to change: what this option changed is already in the rules draft.
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
                <ul className={CS_SMALL}>
                  {section.changes.map((change) => (
                    <li key={change.path.join('.')}>
                      {changeWords(change, { ...names, section: section.section }, settingWords)}
                    </li>
                  ))}
                </ul>
                {warning !== null && (
                  <label className={`${CS_AMBER_NOTE} flex items-center gap-1.5`}>
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
            <p
              className={CS_SMALL}
            >{`Unchanged: the other ${String(data.unchanged.length)} sections.`}</p>
          )}
          {data.fixed_kept !== undefined && data.fixed_kept > 0 && (
            <p
              className={CS_SMALL}
            >{`${String(data.fixed_kept)} fixed setting${data.fixed_kept === 1 ? '' : 's'} stay as the rules draft has them`}</p>
          )}
          {failure?.kind === 'refused' && (
            <p className={CS_AMBER_NOTE} data-testid="promotion-refused">
              {`${failure.message} Nothing was changed. The list above is the rules draft as it is now: look again, then confirm.`}
            </p>
          )}
          {failure?.kind === 'unknown' && (
            <p className={CS_AMBER_NOTE} data-testid="promotion-unknown">
              {`${failure.message} Couldn't tell whether it was saved: look at the rules draft before trying again. `}
              <Link to={rulesHref} className="underline">
                Rules ›
              </Link>
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
