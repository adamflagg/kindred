import { useSearchParams } from 'react-router'
import { useEffect } from 'react'
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

/**
 * /post-check/popout
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
 */
export default function PostCheckPopout() {
  const [params] = useSearchParams()
  const sessionStr = params.get('session')
  const scenarioId = params.get('scenario') ?? undefined
  const year = useYear()

  useEffect(() => {
    document.title = sessionStr ? `Post-Check · Session ${sessionStr}` : 'Post-Check'
  }, [sessionStr])

  if (!sessionStr) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Session required</h1>
        <p className="text-sm text-stone-600">
          Missing <code>?session=&lt;cm_id&gt;</code> query param.
        </p>
      </div>
    )
  }

  const sessionCmId = parseInt(sessionStr, 10)
  if (Number.isNaN(sessionCmId)) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Invalid session id</h1>
        <p className="text-sm text-stone-600">
          The <code>session</code> param must be a numeric CampMinder session id.
        </p>
      </div>
    )
  }

  return <PostCheckPopoutContents sessionCmId={sessionCmId} scenarioId={scenarioId} year={year} />
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
    queryKey: ['post-check', sessionCmId, scenarioId] as const,
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
