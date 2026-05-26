import { Suspense, useEffect, useState } from 'react'
import { Modal } from './ui/Modal'
import type { ImpossibilityReportItem, SolverDiagnostics } from '../services/solver'
import { CamperNameButton } from './impossibility/CamperNameButton'
import { LazyCamperDetailsPanel } from './impossibility/LazyCamperDetailsPanel'
import { BunkRequestProvider } from '../providers/BunkRequestProvider'
import { ErrorBoundary } from './ErrorBoundary'

interface Props {
  isOpen: boolean
  onClose: () => void
  diagnostics: SolverDiagnostics
  sessionCmId: number | null
  year: number
}

function compactDetail(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return ''
  return Object.entries(detail)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ')
}

export default function SolverDiagnosticsModal({
  isOpen,
  onClose,
  diagnostics,
  sessionCmId,
  year,
}: Props) {
  const [selectedCamperId, setSelectedCamperId] = useState<string | null>(null)
  // Reset the drill-through selection when the modal closes, so reopening it
  // doesn't immediately pop the previously-selected camper's details panel.
  useEffect(() => {
    if (!isOpen) setSelectedCamperId(null)
  }, [isOpen])
  const { infeasibilityCause, localization, impossibilityReport } = diagnostics
  const hasAny =
    Boolean(infeasibilityCause) ||
    (localization?.campers.length ?? 0) > 0 ||
    (impossibilityReport?.flat.length ?? 0) > 0

  const header = (
    <div className="border-border/50 flex items-center justify-between border-b px-5 py-3">
      <div>
        <div className="text-foreground text-sm font-bold">Solver could not find a solution</div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          session={sessionCmId ?? '—'} · year={year}
        </div>
      </div>
    </div>
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      header={header}
      size="2xl"
      scrollable
      ariaLabel="Solver infeasibility diagnostics"
    >
      <div className="space-y-5 px-5 py-4">
        {!hasAny && (
          <div className="rounded-md bg-stone-50 p-3 text-sm text-stone-600">
            No diagnostic detail is available for this run — it may have been cleared by a page
            refresh. Re-run the solver to regenerate it.
          </div>
        )}

        {/* Why the solve failed */}
        {(infeasibilityCause || (localization?.campers.length ?? 0) > 0) && (
          <section>
            <h3 className="mb-1 text-sm font-bold text-red-800">Why the solve failed</h3>
            {infeasibilityCause && (
              <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {infeasibilityCause}
              </p>
            )}
            {localization && localization.campers.length > 0 && (
              <div className="mt-2 rounded-md border border-red-200 bg-white p-3">
                <p className="text-xs text-stone-600">{localization.notes}</p>
                <ul className="mt-2 space-y-1">
                  {localization.campers.map((c) => (
                    <li key={c.cm_id} className="text-sm">
                      <CamperNameButton
                        cmId={c.cm_id}
                        name={c.name}
                        onSelect={setSelectedCamperId}
                        disabled={sessionCmId === null}
                      />{' '}
                      <span className="text-stone-500">
                        ({c.cm_id}
                        {c.grade != null ? `/g${c.grade}` : ''}
                        {c.gender ? `/${c.gender}` : ''})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Requests that can never be satisfied */}
        {impossibilityReport && impossibilityReport.flat.length > 0 && (
          <section>
            <h3 className="mb-1 text-sm font-bold text-stone-700">
              Requests that can never be satisfied ({impossibilityReport.total_impossible})
            </h3>
            <table className="w-full border-collapse text-xs">
              <thead className="bg-stone-100">
                <tr>
                  <th className="border-b border-stone-300 px-2 py-1 text-left font-semibold">
                    Reason
                  </th>
                  <th className="border-b border-stone-300 px-2 py-1 text-left font-semibold">
                    Camper A
                  </th>
                  <th className="border-b border-stone-300 px-2 py-1 text-left font-semibold">
                    Camper B
                  </th>
                  <th className="border-b border-stone-300 px-2 py-1 text-left font-semibold">
                    Type
                  </th>
                  <th className="border-b border-stone-300 px-2 py-1 text-left font-semibold">
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {impossibilityReport.flat.map((item: ImpossibilityReportItem) => (
                  <tr
                    key={`${item.request_id}-${item.reason_code}`}
                    className="border-b border-stone-200"
                  >
                    <td className="px-2 py-1">
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-700">
                        {item.reason_code}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <CamperNameButton
                        cmId={item.requester.cm_id}
                        name={item.requester.name}
                        onSelect={setSelectedCamperId}
                        disabled={sessionCmId === null}
                      />
                    </td>
                    <td className="px-2 py-1">
                      {item.requestee ? (
                        <CamperNameButton
                          cmId={item.requestee.cm_id}
                          name={item.requestee.name}
                          onSelect={setSelectedCamperId}
                          disabled={sessionCmId === null}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-1 text-stone-600">{item.request_type}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-stone-600">
                      {compactDetail(item.detail)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {selectedCamperId != null && sessionCmId != null && (
        <BunkRequestProvider sessionCmId={sessionCmId}>
          <ErrorBoundary
            fallback={(error, reset) => (
              <div className="fixed inset-y-0 right-0 z-50 m-4 max-w-md rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
                <p>Couldn&apos;t load camper details: {error.message}</p>
                <button
                  type="button"
                  onClick={() => {
                    reset()
                    setSelectedCamperId(null)
                  }}
                  className="mt-2 rounded bg-red-600 px-3 py-1 text-white"
                >
                  Close
                </button>
              </div>
            )}
          >
            <Suspense fallback={null}>
              <LazyCamperDetailsPanel
                camperId={selectedCamperId}
                onClose={() => setSelectedCamperId(null)}
              />
            </Suspense>
          </ErrorBoundary>
        </BunkRequestProvider>
      )}
    </Modal>
  )
}
