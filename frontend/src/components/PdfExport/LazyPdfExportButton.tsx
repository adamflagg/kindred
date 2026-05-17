/**
 * LazyPdfExportButton — single-click download.
 *
 * Lazy-loads @react-pdf/renderer and BunkPlanReport on first click,
 * generates the PDF as a Blob, and triggers a browser download via a
 * synthetic <a> click. Browser settings (e.g. "always ask where to save")
 * control whether the OS save-as dialog appears.
 */
import { useState } from 'react'
import toast from 'react-hot-toast'
import type { ImpossibilityReport, ValidationStatistics } from '../../services/solver'

interface LazyPdfExportButtonProps {
  sessionName: string
  year: number
  plannerName: string
  statistics: ValidationStatistics
  impossibilityReport: ImpossibilityReport
  issues?: Array<{
    type: string
    severity: string
    message: string
    details?: Record<string, unknown>
  }>
}

export function LazyPdfExportButton(props: LazyPdfExportButtonProps) {
  const [busy, setBusy] = useState(false)

  async function handleClick() {
    if (busy) return
    setBusy(true)
    let url: string | null = null
    let a: HTMLAnchorElement | null = null
    try {
      const [{ pdf }, { BunkPlanReport }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./BunkPlanReport'),
      ])
      const filename = `bunk-plan-${props.sessionName.replace(/\s+/g, '-').toLowerCase()}-${props.year}.pdf`
      const blob = await pdf(<BunkPlanReport {...props} />).toBlob()
      url = URL.createObjectURL(blob)
      a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
    } catch (err) {
      console.error('PDF export failed', err)
      toast.error('PDF export failed. Please try again.')
    } finally {
      if (a && a.parentNode) a.parentNode.removeChild(a)
      if (url) URL.revokeObjectURL(url)
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
    >
      {busy ? 'Preparing PDF…' : 'Export PDF'}
    </button>
  )
}
