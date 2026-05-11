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

export function getLayerCompletion(layerId: LayerId) {
  const storage = getTourStorage()
  return storage.layers[layerId] ?? null
}

export function markLayerCompleted(layerId: LayerId, version: number): void {
  const storage = getTourStorage()
  storage.layers[layerId] = {
    layerId,
    completedVersion: version,
    completedAt: new Date().toISOString(),
  }
  localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(storage))
}

export function isLayerSeen(layerId: LayerId): boolean {
  return getLayerCompletion(layerId) !== null
}

export function isLayerStaleOrUnseen(
  layerId: LayerId,
  version: number,
  staleDays: number
): boolean {
  const record = getLayerCompletion(layerId)
  if (!record) return true
  if (record.completedVersion < version) return true
  const daysSince = (Date.now() - new Date(record.completedAt).getTime()) / 86_400_000
  return daysSince >= staleDays
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

export function resetAllTours(): void {
  localStorage.removeItem(TOUR_STORAGE_KEY)
}
