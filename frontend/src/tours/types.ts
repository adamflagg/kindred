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

/** A persistent hint dot placed inline next to an interactive element */
export interface HintDefinition {
  /** CSS selector for the element to highlight (should match a data-tour attribute) */
  element: string
  /** Popover title shown when hint is clicked */
  title: string
  /** Popover description shown when hint is clicked */
  description: string
}

/** Definition for a single page tour */
export interface TourDefinition {
  id: TourId
  version: number
  steps: TourStep[]
  /** Check if the page is ready for the tour (key elements rendered) */
  isReady: () => boolean
  /** Persistent contextual hints shown inline next to interactive elements */
  hints?: HintDefinition[]
}
