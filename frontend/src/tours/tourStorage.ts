import type { TourId, TourStorageData, LayerId } from './types'

export const TOUR_STORAGE_KEY = 'kindred_tours'

export function getTourStorage(): TourStorageData {
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY)
    if (!raw) return { completed: {}, layers: {} }
    const parsed = JSON.parse(raw) as TourStorageData
    if (!parsed.layers) parsed.layers = {}
    return parsed
  } catch {
    return { completed: {}, layers: {} }
  }
}

export function isTourCompleted(tourId: TourId, currentVersion: number): boolean {
  const storage = getTourStorage()
  const record = storage.completed[tourId]
  if (!record) return false
  return record.completedVersion >= currentVersion
}

export function markTourCompleted(tourId: TourId, version: number): void {
  const storage = getTourStorage()
  storage.completed[tourId] = {
    tourId,
    completedVersion: version,
    completedAt: new Date().toISOString(),
  }
  localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(storage))
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

export function resetTour(tourId: TourId): void {
  const storage = getTourStorage()
  const completed: TourStorageData['completed'] = {}
  for (const key of Object.keys(storage.completed) as TourId[]) {
    if (key !== tourId && storage.completed[key]) {
      completed[key] = storage.completed[key]
    }
  }
  storage.completed = completed
  localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(storage))
}

export function resetAllTours(): void {
  localStorage.removeItem(TOUR_STORAGE_KEY)
}
