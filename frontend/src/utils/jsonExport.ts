/**
 * Tiny JSON export utility — mirrors `csvExport.downloadCsv` but emits a
 * pretty-printed JSON blob. Used by the Solver Debug page's Export JSON button.
 */

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  // Firefox requires the anchor be attached before click() triggers a download.
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
