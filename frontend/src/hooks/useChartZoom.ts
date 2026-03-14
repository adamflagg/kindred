/**
 * Hook for managing chart zoom/brush state.
 *
 * Each chart should get its own instance to avoid cross-chart
 * zoom contamination (#510). Exposes isZoomedIn to avoid showing
 * a Reset button when the brush covers the full range (#511).
 */

import { useCallback, useMemo, useState } from 'react'

export function useChartZoom(dataLength: number) {
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null)

  const handleBrushChange = useCallback((range: { startIndex?: number; endIndex?: number }) => {
    if (range.startIndex !== undefined && range.endIndex !== undefined) {
      const s = range.startIndex
      const e = range.endIndex
      setZoomRange((prev) => (prev?.[0] === s && prev[1] === e ? prev : [s, e]))
    }
  }, [])

  const resetZoom = useCallback(() => setZoomRange(null), [])

  const isZoomedIn = useMemo(
    () => zoomRange !== null && (zoomRange[0] > 0 || zoomRange[1] < dataLength - 1),
    [zoomRange, dataLength]
  )

  return { zoomRange, setZoomRange, handleBrushChange, resetZoom, isZoomedIn }
}
