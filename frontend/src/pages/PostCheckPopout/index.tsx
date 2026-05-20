import { useSearchParams, useParams } from 'react-router'
import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  PostCheckContents,
  type ValidationResults,
} from '../../components/PostValidationResultsModal'
import { solverService } from '../../services/solver'
import { useApiWithAuth } from '../../hooks/useApiWithAuth'
import { useYear } from '../../hooks/useCurrentYear'
import { queryKeys } from '../../utils/queryKeys'
import type { PreCheckCacheValue } from '../../services/solver'
import { pb } from '../../lib/pocketbase'
import { findSessionByUrlSegment } from '../../utils/sessionUtils'
import type { Session } from '../../types/app-types'

interface CampSessionsResponse {
  id: string
  cm_id: number
  name: string
  session_type: string
  start_date: string
  end_date: string
  year: number
  parent_id: string
}

/**
 * /session/:sessionId/post-check
 *
 * A bare route that renders post-check results without the main app shell.
 * Designed to be opened via window.open() from the session header.
 *
 * Auth note: PocketBase JWT lives in localStorage which is shared across
 * same-origin windows, so auth carries automatically into the popout window.
 *
 * Design choice: Option B (pure-presentational) — PostCheckContents accepts
 * pre-fetched results as props, matching how ValidateBunkingButton drives
 * the modal. The popout fetches the same data independently via useQuery so
 * the result is cached and shareable.
 *
 * The :sessionId path segment is a friendly URL segment (e.g. "2", "taste-1")
 * resolved via findSessionByUrlSegment. The ?scenario= query param is optional.
 */
export default function PostCheckPopout() {
  const { sessionId: sessionIdSegment } = useParams<{ sessionId: string }>()
  const [params] = useSearchParams()
  const scenarioId = params.get('scenario') ?? undefined
  const year = useYear()

  // Fetch all sessions to resolve the friendly URL segment
  const {
    data: allSessions = [],
    isLoading: sessionsLoading,
    isError: sessionsError,
    error: sessionsErrorObj,
  } = useQuery({
    queryKey: queryKeys.sessions(year),
    queryFn: async () => {
      const result = await pb.collection('camp_sessions').getFullList<CampSessionsResponse>({
        filter: `year = ${year} && (session_type = "main" || session_type = "embedded")`,
        sort: 'name',
      })
      return result.map((s) => ({
        id: s.id,
        cm_id: s.cm_id,
        name: s.name,
        session_type: s.session_type,
        start_date: s.start_date,
        end_date: s.end_date,
        year: s.year,
        parent_id: s.parent_id,
      })) as unknown as Session[]
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const session = useMemo(() => {
    if (!sessionIdSegment || allSessions.length === 0) return null
    return findSessionByUrlSegment(allSessions, sessionIdSegment)
  }, [sessionIdSegment, allSessions])

  useEffect(() => {
    document.title = session ? `Post-Check · ${session.name}` : 'Post-Check'
  }, [session])

  if (!sessionIdSegment) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Session required</h1>
        <p className="text-sm text-stone-600">No session segment in URL.</p>
      </div>
    )
  }

  if (sessionsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading session…</p>
      </div>
    )
  }

  // A query failure must surface as an explicit error, not collapse into the
  // "Session not found" state below (which would be reached because allSessions
  // defaults to [] on error). frontend/CLAUDE.md: all 4 query states handled.
  if (sessionsError) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-red-700">Failed to load sessions</h1>
        <p className="mt-1 text-sm text-stone-600">
          {sessionsErrorObj instanceof Error
            ? sessionsErrorObj.message
            : 'An unexpected error occurred.'}
        </p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Session not found</h1>
        <p className="text-sm text-stone-600">
          Could not resolve <code>{sessionIdSegment}</code> to a session.
        </p>
      </div>
    )
  }

  return <PostCheckPopoutContents sessionCmId={session.cm_id} scenarioId={scenarioId} year={year} />
}

/** Inner component that can safely call hooks after param validation. */
function PostCheckPopoutContents({
  sessionCmId,
  scenarioId,
  year,
}: {
  sessionCmId: number
  scenarioId: string | undefined
  year: number
}) {
  const { fetchWithAuth } = useApiWithAuth()

  // Post-check validation — mirrors ValidateBunkingButton's imperative call but
  // expressed as a declarative query so results are cached and the window can
  // be refreshed without re-triggering a spinner.
  //
  // Note: BunkingValidationResult in solver.ts is an older type definition —
  // the actual API response matches ValidationResults. Cast as ValidateBunkingButton does.
  const postCheckQuery = useQuery<ValidationResults>({
    queryKey: queryKeys.postCheck(sessionCmId, scenarioId),
    queryFn: () =>
      solverService.validateBunking(
        String(sessionCmId),
        year,
        scenarioId,
        fetchWithAuth
      ) as unknown as Promise<ValidationResults>,
    staleTime: 5 * 60 * 1000, // 5 min — results don't change unless solver reruns
    refetchOnWindowFocus: false,
    retry: false,
  })

  // Pre-check report — shares the same cache key as ValidateBunkingButton and
  // SolverDebugPage, so if those have run the data is already available.
  const preCheckQuery = useQuery<PreCheckCacheValue>({
    queryKey: queryKeys.preCheck(sessionCmId, year),
    queryFn: () => solverService.preValidateRequests(sessionCmId, year, fetchWithAuth),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  if (postCheckQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading post-check results…</p>
      </div>
    )
  }

  if (postCheckQuery.isError || !postCheckQuery.data) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-red-700">Failed to load results</h1>
        <p className="mt-1 text-sm text-stone-600">
          {postCheckQuery.error instanceof Error
            ? postCheckQuery.error.message
            : 'An unexpected error occurred.'}
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <PostCheckContents
        results={postCheckQuery.data}
        sessionCmId={sessionCmId}
        scenarioId={scenarioId}
        impossibilityReport={preCheckQuery.data?.impossibility_report}
        preCheckError={preCheckQuery.isError}
        hideCloseButton
      />
    </div>
  )
}
