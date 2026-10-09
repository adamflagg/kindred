import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { DefinitionNote } from '../../components/camperships/kit/DefinitionNotes'
import { canOpenCamperships } from '../../config/programAccess'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidDefinitions } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { usePermissions } from '../usePermissions'

const NO_NOTES: DefinitionNote[] = []
const NO_ENTRIES: Array<{ key: string; term: string; text: string }> = []

/**
 * A surface's definition notes (§4.8; D20), and each figure's note number by its key. The route
 * is `view` or `summary`, so the read waits for one of them. Static per surface, so the app cache
 * defaults apply.
 */
export function useAidDefinitions(surface: string) {
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const query = useQuery({
    queryKey: queryKeys.aidDefinitions(surface),
    queryFn: () => fetchAidDefinitions(fetchWithAuth, surface),
    enabled: !isLoading && canOpenCamperships({ hasPermission }),
  })
  const notes = useMemo(
    () =>
      query.data?.notes.map((note) => ({ n: note.n, term: note.term, text: note.text })) ??
      NO_NOTES,
    [query.data]
  )
  // Each note with its key, for a surface that numbers the notes itself (Development's rows).
  const entries = useMemo(
    () =>
      query.data?.notes.map((note) => ({ key: note.key, term: note.term, text: note.text })) ??
      NO_ENTRIES,
    [query.data]
  )
  const numbers = useMemo(
    () => new Map((query.data?.notes ?? []).map((note) => [note.key, note.n] as const)),
    [query.data]
  )
  return {
    notes,
    entries,
    numberOf: (key: string): number | null => numbers.get(key) ?? null,
    isPending: query.isPending,
    error: query.error,
  }
}
