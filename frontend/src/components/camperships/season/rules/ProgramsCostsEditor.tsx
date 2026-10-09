/**
 * Programs and costs' editor (spec §5.2 J): every session of the season is a row — Not running, name, Group, and the
 * `$` boxes for the kind its pick lands on. Save sends only the sections the typing changed, each with the fingerprint
 * the fresh read holds (Review Focus 8); a section someone else changed since the editor opened is never overwritten.
 */
import { ArrowRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  useAidSaveRulesSections,
  useFreshAidRulesDraft,
} from '../../../../hooks/camperships/useAidRulesWrites'
import type { CatalogSession } from '../../../../hooks/camperships/useAidSessionCatalog'
import { useOverlayEscape } from '../../../../hooks/useOverlayEscape'
import type { ApiAidGroup, ApiAidRulesDraft } from '../../../../types/api-types'
import { AidPicker } from '../../kit/AidPicker'
import { EditorActions } from '../../kit/EditorLayout'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_LABEL, CS_SMALL } from '../../kit/csType'
import { MIN_COLUMN } from './programsCostsFlow'
import { ROW, flowItems, useBoxWidth } from './programsCostsLayout'
import {
  NOT_OPEN,
  SUBSECTION_LABELS,
  agWords,
  buildContents,
  cardView,
  docOf,
  editKey,
  kindFor,
  moneyText,
  pickTarget,
  priceWords,
  type CardRow,
  type CardSection,
  type EditField,
  type Edits,
  type ProgramShape,
  type ProgramsCostsDoc,
} from './programsCostsModel'
import { Flow, FormulaLine, PerPersonHead, RowName } from './ProgramsCostsParts'

const SECTIONS: readonly CardSection[] = ['programs', 'cost']
const SUB_ORDER = Object.keys(SUBSECTION_LABELS)
const byDate = (a: CardRow, b: CardRow) =>
  a.session.startDate.localeCompare(b.session.startDate) ||
  a.session.sortOrder - b.session.sortOrder ||
  a.session.cmId - b.session.cmId

/** A group's rows, running and not running alike (a checked row stays where it was), in the read view's order. */
const inPlace = (rows: readonly CardRow[]): CardRow[] => [
  ...rows
    .filter((r) => r.kind !== 'per_person')
    .sort((a, b) => SUB_ORDER.indexOf(a.sub) - SUB_ORDER.indexOf(b.sub) || byDate(a, b)),
  ...rows.filter((r) => r.kind === 'per_person').sort(byDate),
]

const BOX =
  'border-border bg-background w-[92px] rounded-md border px-1.5 text-right text-[13px] tabular-nums disabled:opacity-45'

function MoneyBox({
  label,
  cmId,
  field,
  stored,
  edits,
  red,
  disabled,
  onType,
}: {
  label: string
  cmId: number
  field: 't' | 's' | 'i'
  stored: string | null
  edits: Edits
  red: boolean
  disabled: boolean
  onType: (key: string, value: string, original: string) => void
}) {
  const key = editKey(cmId, field)
  const original = moneyText(stored)
  const raw = edits.get(key) ?? original
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {/* ‹old› → before a typed box (owner 10-08), never "was ‹old›" after it: the box stays where it was. */}
      {edits.has(key) && (
        <span
          data-testid="pc-old"
          className="inline-flex items-center gap-1 text-xs text-amber-700 tabular-nums dark:text-amber-300"
        >
          {priceWords(stored)}
          <ArrowRight className="size-3" />
        </span>
      )}
      <span className="text-muted-foreground">$</span>
      {/* aria-label and aria-invalid are test handles (frontend/CLAUDE.md, Accessibility). */}
      <input
        aria-label={label}
        aria-invalid={red ? 'true' : undefined}
        className={`${BOX} ${red ? 'border-red-500 ring-1 ring-red-500' : edits.has(key) ? 'border-amber-500' : ''}`}
        value={raw}
        placeholder="No price yet"
        disabled={disabled}
        onChange={(e) => onType(key, e.target.value, original)}
      />
    </span>
  )
}

/** A per-person price on its own line under the row (owner 10-08): the session's name keeps the row's width. */
const PRICE_LINE = 'flex items-center justify-end gap-2 pl-5'

export function ProgramsCostsEditor({
  draft: current,
  groups,
  sessions,
  cancelled,
  onDone,
}: {
  draft: ApiAidRulesDraft
  groups: readonly ApiAidGroup[]
  sessions: readonly CatalogSession[]
  cancelled: ReadonlySet<number>
  onDone: (saved: ApiAidRulesDraft | null) => void
}) {
  // The draft as it was when the editor opened. `current` is the live query cache, and `fetchFresh()` writes into that
  // same key: after the "Someone else changed…" refusal it would silently become their draft, and the next Save
  // would compare against it and overwrite their change. Everything below reads the copy.
  const [draft] = useState(current)
  const save = useAidSaveRulesSections()
  const fetchFresh = useFreshAidRulesDraft()
  const [boxRef, width] = useBoxWidth()
  const [edits, setEdits] = useState<Edits>(new Map())
  const [fix, setFix] = useState<{ words: string; boxes: ReadonlySet<string> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const doc = useMemo(() => docOf(draft.document), [draft])
  const opened = useMemo(
    () => cardView(doc, groups, sessions, cancelled),
    [doc, groups, sessions, cancelled]
  )
  const openedRows = useMemo(
    () =>
      new Map(
        [...opened.groups.flatMap((g) => [...g.running, ...g.notRunning]), ...opened.notOpen].map(
          (r) => [r.session.cmId, r] as const
        )
      ),
    [opened]
  )
  // The card as the group picks leave it: a moved row changes group at once, a checked row stays where it is.
  const typed = useMemo(() => {
    const picks: Edits = new Map([...edits].filter(([key]) => key.endsWith(':g')))
    const built = buildContents(doc, opened, sessions, picks)
    if (built.kind !== 'ok') return opened
    const next: ProgramsCostsDoc = {
      ...doc,
      programs:
        (built.contents.programs as Record<string, ProgramShape> | undefined) ?? doc.programs,
      cost: doc.cost,
    }
    return cardView(next, groups, sessions, cancelled)
  }, [edits, doc, opened, sessions, groups, cancelled])

  const saving = save.isPending || checking
  useOverlayEscape(true, () => {
    if (!saving) onDone(null)
  })

  const type = (key: string, value: string, original: string) => {
    setEdits((prev) => {
      const next = new Map(prev)
      if (value === original) next.delete(key)
      else next.set(key, value)
      return next
    })
    setFix((prev) => {
      if (!prev?.boxes.has(key)) return prev
      const boxes = new Set(prev.boxes)
      boxes.delete(key)
      return { ...prev, boxes }
    })
  }

  const states = SECTIONS.map(
    (section) => draft.sections.find((s) => s.section === section)?.status.state ?? 'draft'
  )
  const banner =
    edits.size > 0 || states.every((s) => s === 'draft')
      ? null
      : states.includes('locked')
        ? 'Locked: a posted round read it. Saving may start a new version of it. Posted amounts stand.'
        : 'In effect: saving may start a new version, and the version in effect stays as it is until it is approved.'

  const onSave = async () => {
    setError(null)
    const built = buildContents(doc, opened, sessions, edits)
    if (built.kind === 'invalid') {
      setFix({ words: built.words, boxes: new Set(built.boxes) })
      return
    }
    setFix(null)
    const sections = SECTIONS.filter((s) => built.contents[s] !== undefined)
    if (sections.length === 0) {
      onDone(null)
      return
    }
    setChecking(true)
    let fresh: ApiAidRulesDraft
    try {
      fresh = await fetchFresh()
    } catch (caught) {
      setError(
        `Couldn't check the rules draft is unchanged: ${caught instanceof Error ? caught.message : String(caught)}. Nothing was saved.`
      )
      return
    } finally {
      setChecking(false)
    }
    const contents: Record<string, Record<string, unknown>> = {}
    const expected: Record<string, string> = {}
    for (const section of sections) {
      const content = built.contents[section]
      const was = draft.sections.find((s) => s.section === section)?.fingerprint
      const now = fresh.sections.find((s) => s.section === section)?.fingerprint
      if (content === undefined || !now) {
        setError("Couldn't send this save: reload the rules and try again.")
        return
      }
      if (was !== now) {
        setError(
          'Someone else changed Programs and costs in the rules draft since you opened it. Nothing was saved; your typing is kept. Cancel, then Edit… again to see their change.'
        )
        return
      }
      contents[section] = content
      expected[section] = now
    }
    try {
      onDone(
        await save.mutateAsync({
          base_version: fresh.version,
          contents,
          expected_fingerprints: expected,
        })
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const row = (r: CardRow) => {
    const id = r.session.cmId
    const original = openedRows.get(id) ?? r
    const off = (edits.get(editKey(id, 'nr')) ?? String(original.notRunning)) === 'true'
    const inGroup = r.group !== NOT_OPEN
    const red = (field: EditField) => fix?.boxes.has(editKey(id, field)) ?? false
    const perPerson = inGroup && r.kind === 'per_person'
    const box = (label: string, field: 't' | 's' | 'i', stored: string | null) => (
      <MoneyBox
        label={label}
        cmId={id}
        field={field}
        stored={stored}
        edits={edits}
        red={red(field)}
        disabled={off}
        onType={type}
      />
    )
    const kind = kindFor(original, doc)
    const head = (
      <>
        {inGroup && (
          <input
            type="checkbox"
            checked={off}
            onChange={() => type(editKey(id, 'nr'), String(!off), String(original.notRunning))}
          />
        )}
        <RowName row={r} minimum={false} off={off} />
        <AidPicker
          size="field"
          label="Group"
          className="w-[170px] shrink-0"
          value={r.group}
          options={[
            ...groups.map((g) => [g.pool, g.label] as const),
            [NOT_OPEN, 'Not open to aid'] as const,
          ].map(([value, label]) => {
            const reachable = value === r.group || pickTarget(doc, value, kind) !== null
            return {
              value,
              label: reachable ? label : `${label} (no program prices this kind here)`,
              disabled: !reachable,
            }
          })}
          onChange={(picked) => type(editKey(id, 'g'), picked, original.group)}
        />
      </>
    )
    if (perPerson) {
      return (
        <div
          data-testid={`pc-row-${String(id)}`}
          className={`${ROW} flex-col items-stretch gap-0.5 py-0.5`}
        >
          <div className="flex items-center gap-1.5">{head}</div>
          <div data-testid="pc-price-s" className={PRICE_LINE}>
            <span className={`${CS_SMALL} mr-auto`}>Standard</span>
            {box('Standard', 's', r.standard)}
          </div>
          <div data-testid="pc-price-i" className={PRICE_LINE}>
            <span className={`${CS_SMALL} mr-auto`}>Infant</span>
            {box('Infant', 'i', r.infant)}
          </div>
        </div>
      )
    }
    return (
      <div data-testid={`pc-row-${String(id)}`} className={`${ROW} items-center gap-1.5 py-px`}>
        {head}
        {inGroup && r.kind !== 'typed' && box('Tuition', 't', r.tuition)}
      </div>
    )
  }

  const isOff = (r: CardRow) =>
    (edits.get(editKey(r.session.cmId, 'nr')) ??
      String(openedRows.get(r.session.cmId)?.notRunning ?? false)) === 'true'
  const notOpenItems = flowItems(typed.notOpen, false, null, row)

  return (
    <div className="mt-1.5 space-y-2" data-testid="programs-costs-editor" ref={boxRef}>
      <div className={CS_LABEL}>
        {`Editing Programs and costs in the rules draft (v${String(draft.version)})`}
        <span className={`${CS_SMALL} ml-2 font-normal`}>
          a checked box: not running this season
        </span>
      </div>
      {banner !== null && <p className={CS_SMALL}>{banner}</p>}
      {typed.groups.map((g) => {
        const rows = inPlace([...g.running, ...g.notRunning])
        const perPerson = rows.some((r) => r.kind === 'per_person')
        const items = flowItems(rows, g.subLabels, <PerPersonHead editing />, row)
        return (
          <div key={g.pool} data-testid={`pc-group-${g.pool}`}>
            <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-xs">
              <b data-testid="pc-group-name" className="text-foreground text-[13px] font-bold">
                {g.label}
              </b>
              <span>{`· ${String(rows.filter((r) => !isOff(r)).length)} running`}</span>
              {g.agCount > 0 && <span>{`· ${agWords(g.agCount)}`}</span>}
            </div>
            {perPerson && <FormulaLine />}
            {items.length > 0 && (
              <Flow
                items={items}
                width={width}
                minColumn={perPerson ? MIN_COLUMN.editPerPerson : MIN_COLUMN.edit}
              />
            )}
          </div>
        )
      })}
      {typed.notOpen.length > 0 && (
        <div data-testid="pc-group-none">
          <div className="text-muted-foreground text-xs">
            <b className="text-foreground text-[13px] font-bold">Not open to aid</b>
            {` (${String(typed.notOpen.length)})`}
          </div>
          <Flow items={notOpenItems} width={width} minColumn={MIN_COLUMN.edit} />
        </div>
      )}
      <EditorActions>
        <button
          type="button"
          className={CS_BTN}
          disabled={saving || edits.size === 0}
          onClick={() => void onSave()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={CS_BTN2} disabled={saving} onClick={() => onDone(null)}>
          Cancel
        </button>
        <span className={CS_SMALL}>Esc cancels</span>
        {fix !== null && (
          <span className={`${CS_AMBER_NOTE} min-w-0 truncate`} title={fix.words}>
            {fix.words}
          </span>
        )}
        {error !== null && (
          <span className={`${CS_AMBER_NOTE} min-w-0 truncate`} title={error}>
            {error}
          </span>
        )}
      </EditorActions>
    </div>
  )
}
