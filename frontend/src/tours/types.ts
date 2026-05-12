import type { DriveStep, PopoverDOM } from 'driver.js'

/** Union of all layer identifiers for shared intro tours */
export type LayerId = 'metrics-header' | 'registration-intro' | 'trends-intro'

/** Union of all tour identifiers. Add new tour IDs here as tours are created. */
export type TourId =
  | 'debug'
  | 'retention-overview'
  | 'retention-flow'
  | 'retention-bunks'
  | 'retention-staff'
  | 'registration-overview'
  | 'registration-geo'
  | 'registration-waitlist'
  | 'registration-availability'
  | 'registration-forecast'
  | 'registration-cancellations'
  | 'registration-day1'
  | 'trends-overview'
  | 'trends-velocity'
  | 'trends-cancellations'

/** Versioned layer definition with shared steps */
export interface LayerDefinition {
  id: LayerId
  version: number
  steps: TourStep[]
}

/** Persisted record of a completed layer with timestamp for staleness */
export interface LayerCompletionRecord {
  layerId: LayerId
  completedVersion: number
  completedAt: string
}

/** Shape of the localStorage data */
export interface TourStorageData {
  layers: Partial<Record<LayerId, LayerCompletionRecord>>
}

/** Extended step with optional onPopoverRender for custom rendering */
export interface TourStep extends DriveStep {
  popover?: DriveStep['popover'] & {
    onPopoverRender?: (popover: PopoverDOM, opts: { state: { activeIndex: number } }) => void
  }
}

/** Definition for a single page tour with layer dependencies */
export interface TourDefinition {
  id: TourId
  version: number
  /** Ordered layer chain to prepend (e.g. ['metrics-header', 'registration-intro']) */
  layers: LayerId[]
  steps: TourStep[]
}
