import type { LayerId, TourStorageData } from './types'

export const TOUR_STORAGE_KEY = 'kindred_tours'

export function getTourStorage(): TourStorageData {
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY)
    if (!raw) return { layers: {} }
    const parsed = JSON.parse(raw) as Partial<TourStorageData>
    return { layers: parsed.layers ?? {} }
  } catch {
    return { layers: {} }
  }
}

/** Single-write batch mark for layers. No-op when given an empty array. */
export function batchComplete(layers: Array<{ layerId: LayerId; version: number }>): void {
  if (layers.length === 0) return
  const storage = getTourStorage()
  const now = new Date().toISOString()
  for (const { layerId, version } of layers) {
    storage.layers[layerId] = { layerId, completedVersion: version, completedAt: now }
  }
  localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(storage))
}

/** Nuclear devtools escape hatch — clears all tour state from localStorage. */
export function resetAllTours(): void {
  localStorage.removeItem(TOUR_STORAGE_KEY)
}
