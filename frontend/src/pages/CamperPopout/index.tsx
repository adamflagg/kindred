import { useParams, useSearchParams } from 'react-router'
import { useEffect } from 'react'
import { LazyCamperDetailsPanel } from '../../components/impossibility/LazyCamperDetailsPanel'
import { BunkRequestProvider } from '../../providers/BunkRequestProvider'
import { Suspense } from 'react'
import { ErrorBoundary } from '../../components/ErrorBoundary'

/**
 * /camper/:camperId/popout
 *
 * A bare, chromeless route that renders a single camper's details panel in a
 * dedicated popup window. Opened via window.open() from the post-check popout
 * when the user clicks a camper name there.
 *
 * Auth note: PocketBase JWT lives in localStorage which is shared across
 * same-origin windows, so auth carries automatically into this popup window.
 *
 * Query params:
 *   ?session=<cm_id>  — Required. The CampMinder session id for the
 *                        BunkRequestProvider context.
 */
export default function CamperPopout() {
  const { camperId } = useParams<{ camperId: string }>()
  const [searchParams] = useSearchParams()
  const sessionStr = searchParams.get('session')

  useEffect(() => {
    document.title = camperId ? `Camper ${camperId}` : 'Camper'
  }, [camperId])

  if (!camperId) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">Camper id required</h1>
        <p className="text-sm text-stone-600">Missing camperId in URL path.</p>
      </div>
    )
  }

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

  return <CamperPopoutContents camperId={camperId} sessionCmId={sessionCmId} />
}

/** Inner component — hooks run only after param validation. */
function CamperPopoutContents({
  camperId,
  sessionCmId,
}: {
  camperId: string
  sessionCmId: number
}) {
  return (
    <div className="bg-card flex h-screen flex-col">
      <BunkRequestProvider sessionCmId={sessionCmId}>
        <ErrorBoundary
          fallback={(error, reset) => (
            <div className="m-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
              <p>Couldn&apos;t load camper details: {error.message}</p>
              <button
                type="button"
                onClick={() => reset()}
                className="mt-2 rounded bg-red-600 px-3 py-1 text-white"
              >
                Retry
              </button>
            </div>
          )}
        >
          <Suspense fallback={null}>
            <LazyCamperDetailsPanel embedded camperId={camperId} onClose={() => window.close()} />
          </Suspense>
        </ErrorBoundary>
      </BunkRequestProvider>
    </div>
  )
}
