/**
 * LazyPdfExportButton — defers loading @react-pdf/renderer (~1 MB) until
 * the user explicitly clicks "Export PDF". This keeps the renderer bundle
 * out of the main chunk entirely.
 *
 * Two-phase render:
 *  1. Initial: plain "Export PDF" button (zero PDF overhead).
 *  2. After click: React.lazy loads PDFDownloadLink + BunkPlanReport together,
 *     shown behind a Suspense fallback.
 */
import { Suspense, lazy, useState } from 'react'
import type { ComponentProps } from 'react'
import type { ImpossibilityReport, ValidationStatistics } from '../../services/solver'

// Lazy-loaded inner component — imports BOTH @react-pdf/renderer and BunkPlanReport
// so neither ends up in the main bundle.
const PdfDownloadLink = lazy(async () => {
  const [{ PDFDownloadLink }, mod] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./BunkPlanReport'),
  ])
  return {
    default: ({
      filename,
      ...reportProps
    }: ComponentProps<typeof mod.BunkPlanReport> & { filename: string }) => (
      <PDFDownloadLink document={<mod.BunkPlanReport {...reportProps} />} fileName={filename}>
        {({ loading }: { loading: boolean }) => (loading ? 'Preparing PDF…' : 'Download PDF')}
      </PDFDownloadLink>
    ),
  }
})

interface LazyPdfExportButtonProps {
  sessionName: string
  year: number
  plannerName: string
  statistics: ValidationStatistics
  impossibilityReport: ImpossibilityReport
}

export function LazyPdfExportButton(props: LazyPdfExportButtonProps) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
      >
        Export PDF
      </button>
    )
  }

  return (
    <Suspense fallback={<span className="text-sm text-stone-500">Loading PDF renderer…</span>}>
      <PdfDownloadLink
        {...props}
        filename={`bunk-plan-${props.sessionName.replace(/\s+/g, '-').toLowerCase()}-${props.year}.pdf`}
      />
    </Suspense>
  )
}
