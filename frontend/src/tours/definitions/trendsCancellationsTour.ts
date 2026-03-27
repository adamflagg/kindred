import type { TourDefinition } from '../types'

const trendsCancellationsTour: TourDefinition = {
  id: 'trends-cancellations',
  version: 1,
  layers: ['metrics-header', 'trends-intro'],
  steps: [
    {
      element: '[data-tour="cancel-velocity-controls"]',
      popover: {
        title: 'Cancellation Controls',
        description:
          'Overlay prior years to compare cancellation pace, or split by gender to see if patterns differ. Unlike enrollment velocity, there are no view modes — the chart always shows cumulative cancellations.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="cancel-velocity-chart"]',
      popover: {
        title: 'Cancellation Velocity',
        description:
          'Cumulative cancellations over the season. Drag the range handles at the bottom to zoom into a specific time window. Prior year lines overlay when selected above.',
        side: 'top',
        align: 'start',
      },
    },
  ],
  isReady: () => document.querySelector('[data-tour="cancel-velocity-controls"]') !== null,
}

export default trendsCancellationsTour
