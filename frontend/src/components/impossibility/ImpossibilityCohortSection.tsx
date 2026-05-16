import type { EntirelyImpossibleMpCamper } from '../../services/solver'
import { CamperNameButton } from './CamperNameButton'
import { camperActionHints, friendlyReasonLabel } from './reasonHints'

interface ImpossibilityCohortSectionProps {
  campers: EntirelyImpossibleMpCamper[]
  totalImpossibleRequests: number
  onSelectCamper: (id: string) => void
}

// Red post-check cohort: campers whose every parent request is impossible
// to satisfy. Pre-check captures the full picture (partials too) — this
// surface is intentionally narrowed to the "actionable: confirm with
// family" cohort. Renders nothing when the cohort is empty so callers
// can drop it in unconditionally.
export function ImpossibilityCohortSection({
  campers,
  totalImpossibleRequests,
  onSelectCamper,
}: ImpossibilityCohortSectionProps) {
  if (campers.length === 0) return null

  return (
    <div className="space-y-2 px-5 py-4">
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="font-semibold text-red-900">
          {campers.length} camper{campers.length === 1 ? '' : 's'} won&rsquo;t get any parent
          request fulfilled
        </p>
        <p className="mt-0.5 text-xs text-red-800">
          {totalImpossibleRequests} impossible request
          {totalImpossibleRequests === 1 ? '' : 's'} total in this scenario
        </p>
        <div className="mt-2 space-y-1.5 border-t border-red-200 pt-2">
          {campers.map((camper) => (
            <div key={camper.cm_id} className="flex items-center justify-between gap-2 text-sm">
              <div className="flex-1">
                <CamperNameButton
                  cmId={camper.cm_id}
                  name={camper.name}
                  onSelect={onSelectCamper}
                />
                <span className="ml-2 text-xs text-stone-600">
                  {camperActionHints(camper.reason_codes)}
                </span>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                {camper.reason_codes.map((code) => (
                  <span
                    key={code}
                    className="rounded-full bg-amber-200 px-2 py-0.5 text-xs text-amber-900"
                  >
                    {friendlyReasonLabel(code)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
