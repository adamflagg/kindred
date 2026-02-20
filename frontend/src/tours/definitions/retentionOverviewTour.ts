import type { TourDefinition } from '../types'

const retentionOverviewTour: TourDefinition = {
  id: 'retention-overview',
  version: 1,
  steps: [
    {
      element: '[data-tour="retention-summary-cards"]',
      popover: {
        title: 'Summary Cards',
        description:
          'These show the big picture. Click any card to see the individual campers behind the number.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="retention-demographics"]',
      popover: {
        title: 'Demographic Charts',
        description:
          'Each chart breaks down retention differently. Click bars or data points to drill down.',
        side: 'top',
        align: 'start',
      },
    },
    {
      element: '[data-tour="retention-geographic"]',
      popover: {
        title: 'Geographic Outliers',
        description: 'Outlier sections highlight groups with notably high or low retention.',
        side: 'top',
        align: 'start',
      },
    },
  ],
  hints: [
    {
      element: '[data-tour="retention-summary-cards"]',
      title: 'Clickable Cards',
      description: 'Click any card to drill down to the camper list.',
    },
    {
      element: '[data-tour="retention-demographics"]',
      title: 'Interactive Charts',
      description: 'Click any bar or dot to see the specific campers.',
    },
    {
      element: '[data-tour="retention-session-selector"]',
      title: 'Session Filter',
      description: 'Filter data by specific session.',
    },
  ],
  isReady: () => {
    return document.querySelector('[data-tour="retention-summary-cards"]') !== null
  },
}

export default retentionOverviewTour
