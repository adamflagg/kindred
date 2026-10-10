import { useEffect, useRef, useState } from 'react'

import { useFreshAidFundingSources } from '../../../hooks/camperships/useAidFundingSources'
import { useAidSetSourceGroup } from '../../../hooks/camperships/useAidSourceWrites'
import type {
  ApiAidDevelopmentGroup,
  ApiAidFundingSource,
  ApiAidSourceRow,
} from '../../../types/api-types'
import { AidPickerMulti } from '../kit/AidPicker'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_FGRID_LABEL, CS_FIELD, CS_PMETA } from '../kit/csType'
import { EditorActions, EditorForm } from '../kit/EditorLayout'
import type { AidPickerOption } from '../kit/pickerWords'
import {
  movedFields,
  movedWords,
  OPEN_READ_FAILED,
  rebase,
  RECHECK_FAILED,
} from '../kit/staleCheck'
import { refusalWords } from './refusal'
import {
  coversWords,
  GROUP_WATCHED,
  groupBody,
  groupChanged,
  groupDraftFrom,
  groupEdited,
  poolsOfGroups,
  type GroupDraft,
} from './sourcesModel'

/**
 * "Set a Group…" (P-14; D88, D100, D159; `rules`): a source's reporting groups, any of the season's
 * pools (none is "— no group —"), and its incentive flag, with an optional note (mock option A,
 * owner-approved 10-10: the same multi-select Edit… uses). It writes the route development's own
 * view writes (`PUT /reports/{year}/funding-sources/{source_id}`), so the two views stay one
 * registry; `groups` goes only when the picks changed, so an incentive-only save never rewrites the
 * families. The server's D159 sentence shows, verbatim, when the groups move. Fresh read on open and before
 * sending (P-9; R3-1's re-base).
 */
export function GroupEditor({
  row,
  year,
  source,
  groups,
  names,
  onCancel,
  onDone,
}: {
  row: ApiAidSourceRow
  year: number
  source: ApiAidFundingSource
  groups: readonly ApiAidDevelopmentGroup[]
  /** The rules' program words, for the "Covers:" line. */
  names: Readonly<Record<string, string>>
  onCancel: () => void
  onDone: (words: string) => void
}) {
  const fresh = useFreshAidFundingSources()
  const save = useAidSetSourceGroup()
  const [opened, setOpened] = useState<ApiAidFundingSource | null>(null)
  const [warning, setWarning] = useState('')
  const pools = poolsOfGroups(groups)
  const [draft, setDraft] = useState<GroupDraft>(() => groupDraftFrom(source, pools))
  const [problem, setProblem] = useState<string | null>(null)

  const [initial] = useState(source)
  const poolsRef = useRef(pools)
  useEffect(() => {
    poolsRef.current = pools
  })
  useEffect(() => {
    let live = true
    fresh()
      .then((data) => {
        if (!live) return
        const latest = data.sources.find((s) => s.source_id === initial.source_id) ?? initial
        setOpened(latest)
        setWarning(data.group_change_warning ?? '')
        setDraft(groupDraftFrom(latest, poolsRef.current))
      })
      .catch(() => {
        // A read failed: nothing was written, so it is said as a read (R3-13), never "can't tell".
        if (live) setProblem(OPEN_READ_FAILED)
      })
    return () => {
      live = false
    }
  }, [fresh, initial])

  // The draft as it stands now: typing during the pre-send re-check is what gets sent.
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  const set = (patch: Partial<GroupDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const ready = opened !== null && groupEdited(opened, draft, pools) && !save.isPending

  const send = async () => {
    if (!ready) return
    setProblem(null)
    let latest: ApiAidFundingSource | undefined
    try {
      latest = (await fresh()).sources.find((s) => s.source_id === initial.source_id)
    } catch {
      setProblem(RECHECK_FAILED)
      return
    }
    if (latest === undefined) {
      setProblem('This source is no longer an outside source: classify it first.')
      return
    }
    const changed = movedFields(opened, latest, GROUP_WATCHED)
    if (changed.length > 0) {
      // R3-1: the group or flag the person changed stays; everything else follows the latest.
      const base = groupDraftFrom(opened, pools)
      const next = groupDraftFrom(latest, pools)
      setDraft((typed) => rebase(base, next, typed))
      setOpened(latest)
      setProblem(movedWords(changed))
      return
    }
    try {
      const out = await save.mutateAsync({
        year,
        sourceId: initial.source_id,
        body: groupBody(opened, draftRef.current, pools),
      })
      onDone(
        `${row.description}: reporting group ${out.group_label || 'none'}, ${out.incentive ? 'incentive' : 'need-based'}.`
      )
    } catch (caught) {
      setProblem(refusalWords(caught))
    }
  }

  if (opened === null) {
    return <p className={CS_PMETA}>{problem ?? 'Loading the latest for this source…'}</p>
  }
  const options: Array<AidPickerOption<string>> = groups.map((g) => ({
    value: g.key,
    label: g.label,
  }))
  return (
    <div data-testid="group-editor">
      <EditorForm
        title={`Set a Group · ${row.description}`}
        heading="phead"
        actions={
          <EditorActions reason={ready ? undefined : 'Nothing to save yet.'}>
            <button type="button" className={CS_BTN} disabled={!ready} onClick={() => void send()}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={CS_BTN2} onClick={onCancel}>
              Back
            </button>
            {problem !== null && <span className={CS_AMBER_NOTE}>{problem}</span>}
          </EditorActions>
        }
      >
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="flex items-center gap-2">
              <span className={CS_FGRID_LABEL}>Reporting groups</span>
              <AidPickerMulti
                label="Reporting groups"
                size="field"
                values={draft.groups}
                options={options}
                noun="groups"
                none="— no group —"
                onChange={(next) => set({ groups: next })}
                className="w-52 [&>button]:w-full"
              />
            </span>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={draft.incentive}
                onChange={(event) => set({ incentive: event.target.checked })}
              />
              Incentive (not need-based)
            </label>
            <span className="flex items-center gap-2">
              <span className={CS_FGRID_LABEL}>Note (optional)</span>
              <input
                type="text"
                aria-label="Note (optional)"
                className={`${CS_FIELD} w-56`}
                maxLength={2000}
                placeholder="logged with your name"
                value={draft.note}
                onChange={(event) => set({ note: event.target.value })}
              />
            </span>
          </div>
          <p className={CS_PMETA}>{coversWords(draft.groups, pools, names)}</p>
          {groupChanged(opened, draft, pools) && warning !== '' && (
            <p className={CS_AMBER_NOTE}>{warning}</p>
          )}
        </div>
      </EditorForm>
    </div>
  )
}
