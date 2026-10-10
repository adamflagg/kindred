import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { applyEdits } from '../../components/camperships/season/scenarios/sandboxModel'
import {
  freezeAidScenarioSeason,
  keepAidScenario,
  loadAidScenarioDraft,
  saveAidScenarioDraft,
} from '../../services/camperships/aidApi'
import type {
  ApiAidRulesDocument,
  ApiAidRulesDocumentIn,
  ApiAidScenarioDraft,
  ApiAidScenarioWorkspace,
} from '../../types/api-types'
import { invalidateAidScenarioQueries, queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { documentKey } from './useAidScenarioPricing'

export type LoadFrom =
  { readonly option: string } | { readonly start: 'rules' | 'rules_draft' | 'last_rules' }

/** About one season pricing per pause: price the typing once it stops (§S5 E: "debounced 300ms"). */
const DEBOUNCE_MS = 300
const NO_EDITS: ReadonlyMap<string, string> = new Map()
const STARTS = new Set(['rules', 'rules_draft', 'last_rules'])

const message = (caught: unknown, fallback: string) =>
  caught instanceof Error && caught.message !== '' ? caught.message : fallback

/**
 * The sandbox at work (Scenarios addendum §S5 F, A, B, G):
 * - `type` holds a box's text by its path: the strip prices the typed document (`pricedDocument`, the last one with
 *   no bad figure, once the typing pauses) and nothing is recorded;
 * - `release` (leaving a box, or Enter) records the typed document in one PUT /draft: one trail row per release;
 *   a refusal (a conflict, a write that failed) keeps the typing and puts the server's words in `error`. A posted
 *   round's lock never refuses one: the sandbox never locks (owner, 2026-10-10). With no applications
 *   held yet, nothing is sent and the typing stays (disagreement 17);
 * - every write (release, load, discard, keep, update, Use It) runs after the one before, in the order asked, so a
 *   load or a keep clicked while a box still holds typing waits for that typing to be recorded first;
 * - `error` stays until the next action: typing or another write clears it.
 */
export function useAidScenarioDraft(workspace: ApiAidScenarioWorkspace | undefined) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const [edits, setEdits] = useState<ReadonlyMap<string, string>>(NO_EDITS)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nothingNew, setNothingNew] = useState(false)
  const editsRef = useRef<ReadonlyMap<string, string>>(NO_EDITS)
  const draftRef = useRef<ApiAidScenarioDraft | null>(workspace?.draft ?? null)
  const heldRef = useRef(workspace?.snapshot !== null && workspace?.snapshot !== undefined)
  // The rules version the screen shows (A11b): a draft's first save records it as the version it is built on, so a
  // version approved while staff work doesn't claim a draft they opened on the one before. Later saves ignore it.
  // It re-syncs with draftRef on every read, deliberately: with nothing recorded the draft's document IS that read's
  // rules in effect, so a refresh onto v5 makes the first save v5-based too, and holding v4 here would mislabel it.
  const openedRef = useRef(workspace?.pricing_version ?? null)
  const chain = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    draftRef.current = workspace?.draft ?? null
    heldRef.current = workspace?.snapshot !== null && workspace?.snapshot !== undefined
    openedRef.current = workspace?.pricing_version ?? null
  }, [workspace?.draft, workspace?.snapshot, workspace?.pricing_version])

  const recorded = workspace?.draft?.document ?? null
  const applied = useMemo(
    () => (recorded === null ? null : applyEdits(recorded, edits)),
    [recorded, edits]
  )
  const [pricedDocument, setPricedDocument] = useState<ApiAidRulesDocument | null>(recorded)
  useEffect(() => {
    // A bad figure is neither priced nor recorded: the last good document stays priced.
    if (applied === null || applied.problems.size > 0) return
    const timer = setTimeout(
      () => setPricedDocument(applied.document),
      edits.size === 0 ? 0 : DEBOUNCE_MS
    )
    return () => clearTimeout(timer)
  }, [applied, edits.size])

  const setAll = useCallback((next: ReadonlyMap<string, string>) => {
    editsRef.current = next
    setEdits(next)
  }, [])

  const type = useCallback(
    (key: string, raw: string) => {
      const next = new Map(editsRef.current)
      next.set(key, raw)
      setAll(next)
      setError(null)
      setNothingNew(false)
    },
    [setAll]
  )

  /** Drop the edits a write recorded, keeping any typed since (a value that changed while the write ran). */
  const settleEdits = useCallback(
    (sent: ReadonlyMap<string, string>) => {
      const next = new Map(editsRef.current)
      for (const [key, value] of sent) if (next.get(key) === value) next.delete(key)
      setAll(next)
    },
    [setAll]
  )

  const settleDraft = useCallback(
    (draft: ApiAidScenarioDraft) => {
      draftRef.current = draft
      queryClient.setQueryData<ApiAidScenarioWorkspace>(queryKeys.aidScenarios(year), (old) =>
        old === undefined ? old : { ...old, draft }
      )
    },
    [queryClient, year]
  )

  const run = useCallback(
    (label: string, write: () => Promise<void>, idle?: () => boolean): Promise<boolean> => {
      const done = chain.current.then(async () => {
        if (idle?.() === true) return true
        setBusy(label)
        setError(null)
        setNothingNew(false)
        let landed = true
        try {
          await write()
        } catch (caught) {
          setError(message(caught, "Couldn't do that"))
          landed = false
        }
        try {
          await invalidateAidScenarioQueries(queryClient)
        } catch {
          // a refresh, not part of the write: the chain must keep going
        }
        setBusy(null)
        return landed
      })
      chain.current = done.then(() => undefined)
      return done
    },
    [queryClient]
  )

  const release = useCallback(
    () =>
      run(
        'Recording…',
        async () => {
          const draft = draftRef.current
          if (draft === null) return
          const sent = editsRef.current
          const out = applyEdits(draft.document, sent)
          const good = new Map([...sent].filter(([key]) => !out.problems.has(key)))
          if (documentKey(out.document) !== documentKey(draft.document)) {
            settleDraft(
              await saveAidScenarioDraft(fetchWithAuth, year, {
                document: out.document,
                opened_version: openedRef.current,
              })
            )
          }
          settleEdits(good)
        },
        // Nothing typed, or only bad figures: nothing to record, and nothing on screen changes. Before any
        // applications are held a trail row can't be written (§S5 M; disagreement 17): nothing is sent, the typing
        // stays in its boxes, and the next release after Update Applications records it.
        () => {
          const draft = draftRef.current
          if (draft === null || !heldRef.current || editsRef.current.size === 0) return true
          const out = applyEdits(draft.document, editsRef.current)
          return [...editsRef.current.keys()].every((key) => out.problems.has(key))
        }
      ),
    [run, fetchWithAuth, year, settleDraft, settleEdits]
  )

  const load = useCallback(
    (from: LoadFrom) =>
      run('Loading…', async () => {
        settleDraft(await loadAidScenarioDraft(fetchWithAuth, year, from))
        setAll(NO_EDITS)
      }),
    [run, fetchWithAuth, year, settleDraft, setAll]
  )

  /** Discard Changes (§S5 A6): load what the sandbox was loaded from, again. */
  const discard = useCallback(() => {
    const from = draftRef.current?.from_code ?? 'rules'
    return load(
      STARTS.has(from)
        ? { start: from as 'rules' | 'rules_draft' | 'last_rules' }
        : { option: from }
    )
  }, [load])

  /** Keep… (§S5 B): the next flat letter, with the name given; it keeps the recorded draft, so it queues behind a
   * pending release. Resolves to the new option's code, so Compare can add it to its columns, or null when refused. */
  const keep = useCallback(
    async (name: string): Promise<string | null> => {
      const kept: { code: string | null } = { code: null }
      const landed = await run('Keeping…', async () => {
        kept.code = (await keepAidScenario(fetchWithAuth, year, { name })).code
      })
      return landed ? kept.code : null
    },
    [run, fetchWithAuth, year]
  )

  /** Update Applications (§S5 A3): today's freeze. The server hands back the pile it had when nothing moved. */
  const update = useCallback(
    () =>
      run('Updating the applications…', async () => {
        const before =
          queryClient.getQueryData<ApiAidScenarioWorkspace>(queryKeys.aidScenarios(year))
            ?.snapshot ?? workspace?.snapshot
        const after = await freezeAidScenarioSeason(fetchWithAuth, year)
        if (before?.id !== undefined && after.id === before.id) setNothingNew(true)
      }),
    [run, fetchWithAuth, year, queryClient, workspace?.snapshot]
  )

  /** Use It (§S5 G): record the fitted document, unless the draft moved on since the fit was asked. */
  const adopt = useCallback(
    (document: ApiAidRulesDocumentIn, basedOn: string | null) =>
      run('Recording…', async () => {
        const current = draftRef.current
        if (current === null || (current.trail_id ?? null) !== basedOn)
          throw new Error('Your draft changed since: fit again.')
        settleDraft(
          await saveAidScenarioDraft(fetchWithAuth, year, {
            document,
            opened_version: openedRef.current,
          })
        )
        setAll(NO_EDITS)
      }),
    [run, fetchWithAuth, year, settleDraft, setAll]
  )

  return {
    edits,
    pricedDocument,
    busy,
    error,
    nothingNew,
    type,
    release,
    load,
    discard,
    keep,
    update,
    adopt,
  }
}
