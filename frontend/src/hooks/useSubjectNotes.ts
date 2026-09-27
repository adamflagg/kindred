/**
 * Board notes: the one board-level read and its two writes.
 *
 * No cache options -- the read inherits `utils/queryClient.ts`'s defaults,
 * as the weekend board's primary read path does. Long staleTime is only safe
 * with invalidation on EVERY write, which is why both mutations invalidate the
 * `subject-notes` PREFIX (a writer never knows which boards are cached).
 *
 * `placeholderData` below keeps the read's standard rows on screen across a
 * scenario switch -- see its own comment for why.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import {
  fetchSubjectNotes,
  promoteSubjectNote,
  saveSubjectNote,
  type SubjectNoteKeyInput,
  type SubjectNoteWrite,
} from '../services/subjectNotesApi'
import type { SubjectNotesPayload } from '../types/subjectNotes'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

export function useSubjectNotes({
  year,
  sessionCmId,
  scenario,
  enabled,
}: {
  year: number
  sessionCmId: number
  scenario: string
  /** `bunking.manage` -- a viewer without it reads nothing. */
  enabled: boolean
}) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery<SubjectNotesPayload>({
    queryKey: queryKeys.subjectNotes(sessionCmId, year, scenario),
    enabled: enabled && year > 0 && sessionCmId > 0,
    queryFn: () => fetchSubjectNotes(fetchWithAuth, { year, sessionCmId, scenario }),
    // Standard notes are the same across every scenario of one session, so a
    // scenario-only switch keeps the previous read's STANDARD rows on screen
    // (owner ruling 2026-09-26) rather than blanking every corner and the
    // panel section until the new scenario's read lands. Its PLAN rows
    // belonged to the old scenario and are dropped -- they'd otherwise show
    // as this subject's plan-only note under the wrong scenario. A session or
    // year change returns undefined, so it still blanks like a first load.
    // `queryKeys.subjectNotes` orders the key `[prefix, sessionCmId, year,
    // scenarioId]`.
    placeholderData: (previousData, previousQuery) => {
      const prevKey = previousQuery?.queryKey as
        readonly [string, number, number, string] | undefined
      const samePeriod = prevKey?.[1] === sessionCmId && prevKey[2] === year
      if (!previousData || !samePeriod) return undefined
      return { notes: previousData.notes.filter((note) => note.scenario === '') }
    },
  })
}

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function useSaveSubjectNote() {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (write: SubjectNoteWrite) => saveSubjectNote(fetchWithAuth, write),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjectNotesPrefix() })
    },
    onError: (error) => {
      toast.error(errorText(error, 'Failed to save the note'))
    },
  })
}

export function usePromoteSubjectNote() {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: SubjectNoteKeyInput) => promoteSubjectNote(fetchWithAuth, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subjectNotesPrefix() })
    },
    onError: (error) => {
      toast.error(errorText(error, 'Failed to keep the note on all plans'))
    },
  })
}
