import type { TourId, TourStorageData } from './types'

export const TOUR_STORAGE_KEY = 'kindred_tours'

export function getTourStorage(): TourStorageData {
  try {
    const raw = localStorage.getItem(TOUR_STORAGE_KEY)
    if (!raw) return { completed: {} }
    return JSON.parse(raw) as TourStorageData
  } catch {
    return { completed: {} }
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

export function resetTour(tourId: TourId): void {
  const storage = getTourStorage()
  const completed: TourStorageData['completed'] = {}
  for (const key of Object.keys(storage.completed) as TourId[]) {
    if (key !== tourId) {
      completed[key] = storage.completed[key]
    }
  }
  storage.completed = completed
  localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(storage))
}

export function resetAllTours(): void {
  localStorage.removeItem(TOUR_STORAGE_KEY)
}
