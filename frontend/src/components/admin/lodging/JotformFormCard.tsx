/**
 * One adult weekend's Jotform setting (kindred#2759): the form link or id, the
 * per-form field mapping (question ids change every year, so it is per form),
 * and enabled.
 *
 * Setup is one step (kindred#2828): paste the link and press Save & pull. The
 * pull reads the form's questions from Jotform and resolves each role itself
 * — kept if staff set it, carried if the wording matches last year's, else
 * guessed — so the selects arrive filled, each with a badge saying where its
 * question came from. Staff correct what is wrong and press Save & pull again;
 * with nothing edited the same button reads Pull now.
 *
 * Local state holds only what staff have EDITED, layered over the server row.
 * The card is mounted before the first pull, and that pull is what brings the
 * questions and the mapping — state seeded once at mount would keep the empty
 * mapping and never show it.
 */
import { useState } from 'react'

import { useJotformPull, useSaveJotformForm } from '../../../hooks/useJotformAdmin'
import type { JotformFormRowData } from '../../../types/jotform'
import { JOTFORM_ROLE_LABELS } from './jotformRoles'
import {
  AMBER_NOTE,
  AMBER_PILL,
  BUTTON_PRIMARY,
  FIELD,
  LABEL,
  MUTED_PILL,
  SECTION,
} from './lodgingStyles'

type RoleMeta = NonNullable<JotformFormRowData['field_map_meta']>[string]

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

const FLAG_LABELS: Readonly<Record<string, string>> = {
  wording_changed: 'Wording changed',
  missing: 'Question removed',
  needs_pick: 'Pick a question',
}

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  staff: 'Set by staff',
  carried: 'Same as last year',
  guessed: 'Guessed',
}

/** One role's badge: a flag (amber) wins over where the question came from. */
function RoleBadge({ meta }: { meta: RoleMeta | undefined }) {
  const flag = FLAG_LABELS[meta?.flag ?? '']
  if (flag !== undefined) return <span className={AMBER_PILL}>{flag}</span>
  // A staff role with no question is "staff chose none": nothing to badge.
  const source = (meta?.question_id ?? '') !== '' ? SOURCE_LABELS[meta?.source ?? ''] : undefined
  return source !== undefined ? <span className={MUTED_PILL}>{source}</span> : null
}

/**
 * The years a form title names that are not the tab's year. A title with no
 * year says nothing, so it gets no warning.
 */
function otherYears(title: string, year: number): string[] {
  const years: string[] = title.match(/\b20\d{2}\b/g) ?? []
  return years.includes(String(year)) ? [] : [...new Set(years)]
}

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => (a[key] ?? '') === (b[key] ?? ''))
}

export function JotformFormCard({ row, year }: { row: JotformFormRowData; year: number }) {
  const save = useSaveJotformForm(year)
  const pull = useJotformPull()
  const [editedRef, setEditedRef] = useState<string | undefined>(undefined)
  const [editedEnabled, setEditedEnabled] = useState<boolean | undefined>(undefined)
  const [editedMap, setEditedMap] = useState<Record<string, string>>({})
  const savedFormId = row.form_id ?? ''
  const formRef = editedRef ?? savedFormId
  // A weekend with no form yet defaults to enabled: pasting a link and pressing
  // Save & pull is the whole setup, and a disabled form would pull nothing.
  const savedEnabled = savedFormId === '' ? true : (row.enabled ?? false)
  const enabled = editedEnabled ?? savedEnabled
  // Question ids belong to one form. Once the reference names a DIFFERENT
  // form, the old questions and mapping no longer apply: nothing is shown or
  // sent until that form's first pull (the server drops the mapping too).
  const otherForm = savedFormId !== '' && !namesForm(formRef, savedFormId)
  const savedMap = row.field_map ?? {}
  // The resolved map the last pull wrote; an edit ('' included, which is "no
  // question") wins over it.
  const fieldMap: Record<string, string> = otherForm ? {} : { ...savedMap, ...editedMap }
  const questions = otherForm ? [] : (row.questions ?? [])
  const meta = otherForm ? {} : (row.field_map_meta ?? {})
  const lastPull = row.last_pull_status ?? ''
  const title = otherForm ? '' : (row.form_title ?? '').trim()
  const wrongYears = otherYears(title, year)

  const refChanged = savedFormId === '' ? formRef.trim() !== '' : otherForm
  const dirty = refChanged || enabled !== (row.enabled ?? false) || !sameMap(fieldMap, savedMap)
  const busy = save.isPending || pull.isPulling

  async function saveAndPull() {
    if (dirty) {
      try {
        await save.mutateAsync({
          sessionCmId: row.session_cm_id,
          body: {
            form_ref: formRef.trim(),
            field_map: Object.fromEntries(
              Object.entries(fieldMap).filter(([, questionId]) => questionId !== '')
            ),
            enabled,
          },
        })
      } catch {
        // useSaveJotformForm has toasted why; a failed save must not pull.
        return
      }
      // The saved row is now the server's; the next pull re-resolves it.
      setEditedRef(undefined)
      setEditedEnabled(undefined)
      setEditedMap({})
    }
    await pull.pull()
  }

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
        {title !== '' && (
          <div className="flex flex-col gap-0.5 sm:col-span-2">
            <span className="text-foreground text-sm">{title}</span>
            {wrongYears.length > 0 && (
              <span className={AMBER_NOTE}>
                {`This form's title says ${wrongYears.join(', ')}, not ${String(year)} — check it is this year's form.`}
              </span>
            )}
          </div>
        )}
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
          Paste the form&apos;s builder link and click Save &amp; pull. Kindred reads the
          form&apos;s questions from Jotform, maps them, and matches the submissions.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <h4 className={`${SECTION} sm:col-span-2`}>Field mapping</h4>
          {Object.entries(JOTFORM_ROLE_LABELS).map(([role, label]) => {
            // An edit replaces what the pull resolved, so its badge no longer applies.
            const edited = role in editedMap && editedMap[role] !== (savedMap[role] ?? '')
            return (
              <label key={role} data-testid={`jotform-role-${role}`}>
                <span className={`${LABEL} flex items-center gap-2`}>
                  {label}
                  {!edited && <RoleBadge meta={meta[role]} />}
                </span>
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
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-muted-foreground text-xs">
          Pulls every enabled weekend&apos;s form, not only this one.
        </span>
        <button
          type="button"
          className={BUTTON_PRIMARY}
          disabled={busy || formRef.trim() === ''}
          onClick={() => {
            void saveAndPull()
          }}
        >
          {dirty ? 'Save & pull' : 'Pull now'}
        </button>
      </div>
    </section>
  )
}
