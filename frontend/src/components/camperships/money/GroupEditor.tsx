import { useEffect, useState } from 'react'

import { useFreshAidFundingSources } from '../../../hooks/camperships/useAidFundingSources'
import { useAidSetSourceGroup } from '../../../hooks/camperships/useAidSourceWrites'
import type {
  ApiAidDevelopmentGroup,
  ApiAidFundingSource,
  ApiAidSourceRow,
} from '../../../types/api-types'
import { CS_AMBER_NOTE, CS_BTN, CS_BTN2, CS_INPUT, CS_PMETA } from '../kit/csType'
import {
  movedFields,
  movedWords,
  OPEN_READ_FAILED,
  rebase,
  RECHECK_FAILED,
} from '../kit/staleCheck'
import { refusalWords } from './refusal'
import {
  GROUP_WATCHED,
  groupBody,
  groupChanged,
  groupDraftFrom,
  groupEdited,
  KEEP_GROUPS,
  NO_GROUP,
  offersNoGroup,
  type GroupDraft,
} from './sourcesModel'

/**
 * "Set a Group…" (P-14; D88, D100, D159; `rules`): a source's reporting group, one of the season's
 * pools or none, and its incentive flag, with an optional note. It writes the route development's
 * own view writes (`PUT /reports/{year}/funding-sources/{source_id}`), so the two views stay one
 * registry. A source over several pools keeps them unless one pool is picked; "no group" isn't
 * offered for it, since the route would keep the pools anyway (R3-7: pick one pool, then clear it).
 * The server's D159 sentence shows, verbatim, when the group moves. Fresh read on open and before
 * sending (P-9; R3-1's re-base).
 */
export function GroupEditor({
  row,
  year,
  source,
  groups,
  onCancel,
  onDone,
}: {
  row: ApiAidSourceRow
  year: number
  source: ApiAidFundingSource
  groups: readonly ApiAidDevelopmentGroup[]
  onCancel: () => void
  onDone: (words: string) => void
}) {
  const fresh = useFreshAidFundingSources()
  const save = useAidSetSourceGroup()
  const [opened, setOpened] = useState<ApiAidFundingSource | null>(null)
  const [warning, setWarning] = useState('')
  const [draft, setDraft] = useState<GroupDraft>(() => groupDraftFrom(source))
  const [problem, setProblem] = useState<string | null>(null)

  const [initial] = useState(source)
  useEffect(() => {
    let live = true
    fresh()
      .then((data) => {
        if (!live) return
        const latest = data.sources.find((s) => s.source_id === initial.source_id) ?? initial
        setOpened(latest)
        setWarning(data.group_change_warning ?? '')
        setDraft(groupDraftFrom(latest))
      })
      .catch(() => {
        // A read failed: nothing was written, so it is said as a read (R3-13), never "can't tell".
        if (live) setProblem(OPEN_READ_FAILED)
      })
    return () => {
      live = false
    }
  }, [fresh, initial])

  const set = (patch: Partial<GroupDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const ready = opened !== null && groupEdited(opened, draft) && !save.isPending

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
      const base = groupDraftFrom(opened)
      const next = groupDraftFrom(latest)
      setDraft((typed) => rebase(base, next, typed))
      setOpened(latest)
      setProblem(movedWords(changed))
      return
    }
    try {
      const out = await save.mutateAsync({
        year,
        sourceId: initial.source_id,
        body: groupBody(draft),
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
  return (
    <div className="space-y-2 text-sm" data-testid="group-editor">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          Reporting group
          <select
            className={CS_INPUT}
            value={draft.group}
            onChange={(event) => set({ group: event.target.value })}
          >
            {groupDraftFrom(opened).group === KEEP_GROUPS && (
              <option value={KEEP_GROUPS}>{`${opened.group_label} (keep them)`}</option>
            )}
            {offersNoGroup(opened) && <option value={NO_GROUP}>— no group —</option>}
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.incentive}
            onChange={(event) => set({ incentive: event.target.checked })}
          />
          Incentive (not need-based)
        </label>
        <label className="flex min-w-[14rem] flex-1 items-center gap-2">
          Note (optional)
          <input
            type="text"
            className={`${CS_INPUT} w-full`}
            maxLength={2000}
            value={draft.note}
            onChange={(event) => set({ note: event.target.value })}
          />
        </label>
      </div>
      {groupChanged(opened, draft) && warning !== '' && <p className={CS_AMBER_NOTE}>{warning}</p>}
      {problem !== null && <p className={CS_AMBER_NOTE}>{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={CS_BTN} disabled={!ready} onClick={() => void send()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className={CS_BTN2} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  )
}
