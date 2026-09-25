/**
 * One adult weekend's Jotform setting (kindred#2759): the form link or id, the
 * per-form field mapping (question ids change every year, so it is set here,
 * suggested from the question text and confirmed by staff), and enabled.
 *
 * Local state holds only what staff have EDITED, layered over the server row.
 * The card is mounted before the first pull, and that pull is what brings the
 * questions and the suggested mapping — state seeded once at mount would keep
 * the empty mapping and never show the suggestion.
 */
import { useState } from 'react'

import { useSaveJotformForm } from '../../../hooks/useJotformAdmin'
import type { JotformFormRowData } from '../../../types/jotform'
import { JOTFORM_ROLE_LABELS } from './jotformRoles'
import { BUTTON_PRIMARY, FIELD, LABEL, MUTED_PILL, SECTION } from './lodgingStyles'

/**
 * Whether a typed reference still names the saved form: the bare id, or any
 * link whose path carries it (as the server's `parse_form_id` reads it).
 */
function namesForm(ref: string, formId: string): boolean {
  const value = ref.trim()
  return value === formId || new RegExp(`(^|/)${formId}(/|$|\\?|#)`).test(value)
}

function shortQuestion(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 70 ? `${trimmed.slice(0, 67)}…` : trimmed
}

export function JotformFormCard({ row, year }: { row: JotformFormRowData; year: number }) {
  const save = useSaveJotformForm(year)
  const [editedRef, setEditedRef] = useState<string | undefined>(undefined)
  const [editedEnabled, setEditedEnabled] = useState<boolean | undefined>(undefined)
  const [editedMap, setEditedMap] = useState<Record<string, string>>({})
  const savedFormId = row.form_id ?? ''
  const formRef = editedRef ?? savedFormId
  const enabled = editedEnabled ?? row.enabled ?? false
  // Question ids belong to one form. Once the reference names a DIFFERENT
  // form, the old questions and mapping no longer apply: nothing is shown or
  // sent until that form's first pull (the server drops the mapping too).
  const otherForm = savedFormId !== '' && !namesForm(formRef, savedFormId)
  // A staff-confirmed mapping wins over the suggestion; an edit ('' included,
  // which is "no question") wins over both.
  const fieldMap: Record<string, string> = otherForm
    ? {}
    : {
        ...(row.suggested_field_map ?? {}),
        ...(row.field_map ?? {}),
        ...editedMap,
      }
  const questions = otherForm ? [] : (row.questions ?? [])
  const confirmed = Object.keys(row.field_map ?? {}).length > 0
  const lastPull = row.last_pull_status ?? ''

  return (
    <section
      data-testid={`jotform-form-${String(row.session_cm_id)}`}
      className="card-lodge flex flex-col gap-3 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-foreground font-semibold">{row.session_name}</h3>
        <span className={MUTED_PILL}>{`${String(row.submission_count ?? 0)} submissions`}</span>
      </div>
      <p className="text-muted-foreground text-xs">
        {lastPull !== '' ? `Last pull: ${lastPull}` : 'Not pulled yet'}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className={LABEL}>Form builder link or form ID</span>
          <input
            className={FIELD}
            value={formRef}
            placeholder="https://www.jotform.com/build/…"
            aria-label={`Form link for ${row.session_name}`}
            onChange={(event) => {
              setEditedRef(event.target.value)
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEditedEnabled(event.target.checked)
            }}
          />
          Enabled
        </label>
      </div>

      {questions.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Save the form, enable it and pull once to load its questions. Then confirm which question
          is which.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <h4 className={`${SECTION} sm:col-span-2`}>
            {confirmed ? 'Field mapping' : 'Field mapping — suggested, please confirm'}
          </h4>
          {Object.entries(JOTFORM_ROLE_LABELS).map(([role, label]) => (
            <label key={role}>
              <span className={LABEL}>{label}</span>
              <select
                className={FIELD}
                aria-label={`${label} question for ${row.session_name}`}
                value={fieldMap[role] ?? ''}
                onChange={(event) => {
                  const questionId = event.target.value
                  setEditedMap((current) => ({ ...current, [role]: questionId }))
                }}
              >
                <option value="">—</option>
                {questions.map((question) => (
                  <option key={question.question_id} value={question.question_id}>
                    {shortQuestion(question.text ?? '')}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className={BUTTON_PRIMARY}
          aria-label={`Save ${row.session_name}`}
          disabled={save.isPending || formRef.trim() === ''}
          onClick={() => {
            save.mutate({
              sessionCmId: row.session_cm_id,
              body: {
                form_ref: formRef.trim(),
                field_map: Object.fromEntries(
                  Object.entries(fieldMap).filter(([, questionId]) => questionId !== '')
                ),
                enabled,
              },
            })
          }}
        >
          Save
        </button>
      </div>
    </section>
  )
}
