import type { DriveStep, PopoverDOM } from 'driver.js'

/** Union of all tour identifiers. Add new tour IDs here as tours are created. */
export type TourId =
  | 'debug'
  | 'retention-overview'
  | 'retention-flow'
  | 'retention-bunks'
  | 'retention-staff'

/** Persisted record of a completed tour */
export interface TourCompletionRecord {
  tourId: TourId
  completedVersion: number
  completedAt: string
}

/** Shape of the localStorage data */
export interface TourStorageData {
  completed: Partial<Record<TourId, TourCompletionRecord>>
}

/** Extended step with optional onPopoverRender for custom rendering */
export interface TourStep extends DriveStep {
  popover?: DriveStep['popover'] & {
    onPopoverRender?: (popover: PopoverDOM, opts: { state: { activeIndex: number } }) => void
  }
}

/** Definition for a single page tour */
export interface TourDefinition {
  id: TourId
  version: number
  steps: TourStep[]
  /** Check if the page is ready for the tour (key elements rendered) */
  isReady: () => boolean
}
