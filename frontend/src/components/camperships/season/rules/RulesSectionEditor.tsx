import { useCallback, useEffect, useState, type ReactNode } from 'react'

import {
  useAidSaveRulesSection,
  useFreshAidRulesDraft,
} from '../../../../hooks/camperships/useAidRulesWrites'
import { hasStatus } from '../../../../services/camperships/aidApi'
import type {
  ApiAidRulesDraft,
  ApiAidRulesSection,
  ApiAidSectionSaveIn,
} from '../../../../types/api-types'
import { useOverlayEscape } from '../../../../hooks/useOverlayEscape'
import { AMBER_NOTE, BUTTON_SECONDARY } from '../../../admin/lodging/lodgingStyles'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_LABEL, CS_SMALL } from '../../kit/csType'
import type { CellControl } from './CardTables'
import { savePrecondition } from './precondition'
import { RuleControl } from './RuleControl'
import type { CardRow } from './rulesCards'
import { sectionContent } from './rulesDraft'
import { SECTION_TITLES, changeWords, formatSetting, type RulesNames } from './rulesModel'
import {
  editKey,
  fieldName,
  fieldSpec,
  fixFirstWords,
  prepareContent,
  refusalWords,
  sectionChanges,
  touches,
  valueAt,
  type EditContext,
} from './sectionEdit'
import { SectionView } from './SectionView'
import { useSectionDraft } from './useSectionDraft'

interface Opened {
  /** The draft as read when the editor opened (or when the person put their edit on a newer one). */
  readonly draft: ApiAidRulesDraft
  readonly content: Record<string, unknown>
}

/** What a card's body draws while it is edited: the section as typed so far, and the box for a row or a table cell. */
export interface EditorBody {
  readonly content: Record<string, unknown>
  readonly control: (row: CardRow) => ReactNode
  readonly cell: CellControl
}

const NO_CONTENT: Record<string, unknown> = {}

/** Why nothing was saved: someone else's change, found by the check before sending or by a 409. */
type Refusal =
  | { readonly kind: 'loading'; readonly server: string | null }
  | { readonly kind: 'loaded'; readonly server: string | null; readonly fresh: ApiAidRulesDraft }
  | { readonly kind: 'failed'; readonly server: string | null; readonly reason: string }

const reasonOf = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught))

/**
 * The section editor's rules home (spec §7.5; D39) and its answer when someone else changed the
 * section (Decision 16, owner ruling 2026-10-02).
 * - It opens on the draft as the server holds it now, not the cache.
 * - Before sending, it reads the draft again. If the section (or the draft's version) moved, nothing is
 *   sent: the typing stays, the editor says what changed, and offers to put the typing on the new draft.
 * - The save carries the section's fingerprint, so a save made in the instant between that read and
 *   the write is refused (409) too. A 409 reads the draft again the same way.
 * - If that read fails, it says so with "Try Again"; the typing is kept and Cancel still leaves.
 * It never re-sends on its own.
 */
export function RulesSectionEditor({
  section,
  draft,
  names,
  context,
  renderBody,
  saveAs,
  onDone,
}: {
  section: ApiAidRulesSection
  /** The Rules tab's read of the rules draft: the section's status for the banner. */
  draft: ApiAidRulesDraft
  /** The rules' own names, as the read view has them (#15): a box still keeps and sends the key. */
  names?: RulesNames | undefined
  /** What the lifted settings' boxes offer (classes, pools, sessions, programs); without it they stay as text. */
  context?: EditContext | undefined
  /** The card's own body with its boxes (spec §6.2 F). Without it the section's settings list, each with its box. */
  renderBody?: ((body: EditorBody) => ReactNode) | undefined
  /**
   * For a body that builds the section itself (the tiers editor): what Save sends, null while one of its boxes can't be
   * read. Without it Save sends the typed boxes.
   */
  saveAs?: { readonly content: Record<string, unknown> | null } | undefined
  /** The saved draft, or null when cancelled. */
  onDone: (saved: ApiAidRulesDraft | null) => void
}) {
  const save = useAidSaveRulesSection()
  const fetchFresh = useFreshAidRulesDraft()
  const [opened, setOpened] = useState<Opened | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = draft.sections.find((s) => s.section === section)?.status.state ?? 'draft'
  const openedContent = opened?.content ?? NO_CONTENT
  const specOf = useCallback(
    (path: readonly string[]) =>
      fieldSpec(path, valueAt(openedContent, path), openedContent, context),
    [openedContent, context]
  )
  const draftState = useSectionDraft(openedContent, specOf)
  const saving = save.isPending || checking
  // Esc is Cancel, as in the household editors: nothing is left behind, and a running save finishes.
  useOverlayEscape(opened !== null, () => {
    if (!saving) onDone(null)
  })

  const open = useCallback(() => {
    void fetchFresh().then(
      (fresh) => setOpened({ draft: fresh, content: sectionContent(fresh.document, section) }),
      (caught: unknown) => setOpenError(reasonOf(caught))
    )
  }, [fetchFresh, section])
  useEffect(open, [open])

  /** Read the draft again after a refusal; a failed read keeps the refusal open with "Try Again". */
  const reload = useCallback(
    (server: string | null) => {
      setRefusal({ kind: 'loading', server })
      void fetchFresh().then(
        (fresh) => setRefusal({ kind: 'loaded', server, fresh }),
        (caught: unknown) => setRefusal({ kind: 'failed', server, reason: reasonOf(caught) })
      )
    },
    [fetchFresh]
  )

  if (opened === null) {
    return openError === null ? (
      <p className="text-muted-foreground text-sm">Loading the rules draft as it is now…</p>
    ) : (
      <div className="space-y-1" data-testid="rules-open-failed">
        <p className={AMBER_NOTE}>{`Couldn't load the rules draft: ${openError}`}</p>
        <div className="flex gap-2">
          <button
            type="button"
            className={BUTTON_SECONDARY}
            onClick={() => {
              setOpenError(null)
              open()
            }}
          >
            Try Again
          </button>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const moved = (fresh: ApiAidRulesDraft) =>
    fresh.version !== opened.draft.version ||
    sectionChanges(opened.content, sectionContent(fresh.document, section)).length > 0

  const onSave = async (content: Record<string, unknown>) => {
    setRefusal(null)
    setError(null)
    setChecking(true)
    let fresh: ApiAidRulesDraft
    try {
      fresh = await fetchFresh()
    } catch (caught) {
      setError(
        `Couldn't check the rules draft is unchanged: ${reasonOf(caught)}. Nothing was saved.`
      )
      return
    } finally {
      setChecking(false)
    }
    if (moved(fresh)) {
      setRefusal({ kind: 'loaded', server: null, fresh })
      return
    }
    let body: ApiAidSectionSaveIn
    try {
      body = {
        base_version: opened.draft.version,
        content,
        ...savePrecondition(opened.draft, section),
      }
    } catch {
      // A section without a fingerprint: nothing can be sent, and the person is told.
      setError("Couldn't send this save: reload the rules and try again.")
      return
    }
    save.mutate(
      { section, body },
      {
        onSuccess: (saved) => onDone(saved),
        onError: (caught) => {
          if (hasStatus(caught, 409)) reload(caught.message)
          else
            setError(
              hasStatus(caught, 422)
                ? (refusalWords(caught.message) ?? caught.message)
                : caught.message
            )
        },
      }
    )
  }

  const banner = (mine: readonly string[][]) => {
    const notes: ReactNode[] = []
    if (status !== 'draft') {
      notes.push(
        <p key="in-use" className="text-muted-foreground text-xs">
          {status === 'locked'
            ? 'Locked: a posted round read it. Saving may start a new version of it. Posted amounts stand.'
            : 'In effect: saving may start a new version, and the version in effect stays as it is until it is approved.'}
        </p>
      )
    }
    if (refusal !== null) {
      notes.push(
        <div key="refused" className="space-y-1" data-testid="rules-conflict">
          {/* The UI's own sentence leads; the server's 409 text is the detail (plan review M4). */}
          <p className={AMBER_NOTE}>
            Someone else changed the rules draft since you opened this section. Nothing was saved;
            your typing is kept.
          </p>
          {refusal.server !== null && (
            <p className="text-muted-foreground text-xs">{refusal.server}</p>
          )}
          {refusal.kind === 'loading' && (
            <p className="text-muted-foreground text-xs">Loading what changed…</p>
          )}
          {refusal.kind === 'failed' && (
            <div className="flex items-center gap-2 text-xs">
              <span>{`Couldn't load what changed: ${refusal.reason}`}</span>
              <button
                type="button"
                className={BUTTON_SECONDARY}
                onClick={() => reload(refusal.server)}
              >
                Try Again
              </button>
            </div>
          )}
          {refusal.kind === 'loaded' && (
            <Moved
              fresh={refusal.fresh}
              section={section}
              opened={opened.content}
              mine={mine}
              onRebase={() => {
                setOpened({
                  draft: refusal.fresh,
                  content: sectionContent(refusal.fresh.document, section),
                })
                setRefusal(null)
              }}
            />
          )}
        </div>
      )
    }
    return notes.length === 0 ? null : <div className="space-y-1">{notes}</div>
  }

  /** The box for one setting: its typed value, "was ‹old›" once changed, and its problem; plain words where nothing can be typed. */
  const controlAt = (path: readonly string[]): ReactNode => {
    const value = valueAt(opened.content, path)
    const spec = specOf(path)
    if (spec === null) return <span>{formatSetting(value, path, names)}</span>
    const key = editKey(path)
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <RuleControl
          path={path}
          value={value}
          spec={spec}
          raw={draftState.rawOf(path, value, spec)}
          problem={draftState.applied.problems.get(key) ?? null}
          onChange={(raw) => draftState.set(path, raw)}
        />
        {draftState.changedKeys.has(key) && (
          <span className={CS_AMBER_NOTE}>
            {typeof value === 'boolean'
              ? value
                ? 'was checked'
                : 'was unchecked'
              : `was ${formatSetting(value, path, names)}`}
          </span>
        )}
      </span>
    )
  }
  const body: EditorBody = {
    content: draftState.applied.content,
    control: (row) => controlAt(row.path),
    cell: controlAt,
  }
  // What this editor changes, for "you both changed": the typed boxes' paths, or the paths a built section differs at.
  const mine =
    saveAs?.content != null
      ? sectionChanges(opened.content, saveAs.content).map((change) => [...change.path])
      : draftState.applied.changed
  const unreadable = saveAs?.content === null
  const blocked = draftState.applied.problems.size > 0 || unreadable
  const nothing =
    saveAs === undefined
      ? draftState.applied.changed.length === 0
      : saveAs.content !== null && sectionChanges(opened.content, saveAs.content).length === 0
  return (
    <div className="mt-1.5 space-y-2" data-testid="section-editor">
      <div className={CS_LABEL}>
        {`Editing ${SECTION_TITLES[section]} in the rules draft (v${String(opened.draft.version)})`}
      </div>
      {banner(mine)}
      {renderBody !== undefined ? (
        renderBody(body)
      ) : (
        <SectionView content={body.content} renderValue={(path) => controlAt(path)} names={names} />
      )}
      {error !== null && <p className={CS_AMBER_NOTE}>{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={CS_BTN}
          // Saving stays off while a refusal is open: the person looks at what moved first.
          disabled={saving || refusal !== null || blocked || nothing}
          onClick={() =>
            void onSave(
              saveAs?.content ??
                prepareContent(section, draftState.applied.content, opened.draft.document)
            )
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={CS_BTN2} disabled={saving} onClick={() => onDone(null)}>
          Cancel
        </button>
        <span className={CS_SMALL}>Esc cancels</span>
        {blocked && (
          <span className={CS_AMBER_NOTE}>
            {unreadable
              ? "Fix first: a box isn't a figure"
              : `Fix first: ${fixFirstWords(draftState.applied)}`}
          </span>
        )}
        {draftState.applied.gone.size > 0 && (
          <button type="button" className={CS_BTN2} onClick={draftState.dropGone}>
            Drop What Has Gone
          </button>
        )}
      </div>
    </div>
  )
}

/** What someone else changed in this section, what both changed, and "Put My Edit on vN". */
function Moved({
  fresh,
  section,
  opened,
  mine,
  onRebase,
}: {
  fresh: ApiAidRulesDraft
  section: ApiAidRulesSection
  opened: Record<string, unknown>
  mine: readonly string[][]
  onRebase: () => void
}) {
  const theirs = sectionChanges(opened, sectionContent(fresh.document, section))
  // Overlap by `touches`, never by equality: a change inside a list is reported at the list's path.
  const both = theirs.filter((change) => mine.some((p) => touches(p, change.path)))
  return (
    <>
      <p className="text-xs">
        {`The rules draft is v${String(fresh.version)} now. `}
        {theirs.length === 0
          ? 'Nothing in this section changed since you opened it.'
          : 'Changed in this section since you opened it:'}
      </p>
      {theirs.length > 0 && (
        <ul className="text-xs">
          {theirs.map((change) => (
            <li key={editKey(change.path)}>{changeWords(change)}</li>
          ))}
        </ul>
      )}
      {both.length > 0 && (
        <p className={AMBER_NOTE}>
          You both changed {both.map((change) => fieldName(change.path)).join('; ')}: saving puts
          yours in place of theirs.
        </p>
      )}
      <button type="button" className={BUTTON_SECONDARY} onClick={onRebase}>
        {`Put My Edit on v${String(fresh.version)}`}
      </button>
    </>
  )
}
