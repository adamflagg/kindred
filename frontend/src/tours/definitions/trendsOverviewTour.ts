import type { TourDefinition } from '../types'

const trendsOverviewTour: TourDefinition = {
  id: 'trends-overview',
  version: 1,
  layers: ['metrics-header', 'trends-intro'],
  steps: [
    {
      element: '[data-tour="trends-summary"]',
      popover: {
        title: 'Multi-Year Summary',
        description:
          'High-level trends at a glance — years analyzed, latest enrollment, total change, and average annual growth rate.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="trends-charts"]',
      popover: {
        title: 'Trend Lines',
        description:
          'Enrollment trends over time. Each chart shows a different dimension — total, new vs returning, gender, grade distributions.',
        side: 'top',
        align: 'start',
      },
    },
    {
      element: '[data-tour="trends-table"]',
      popover: {
        title: 'Year-by-Year Table',
        description:
          'Detailed numbers for each year. Compare enrollment, retention rates, and demographic breakdowns across seasons.',
        side: 'top',
        align: 'start',
      },
    },
  ],
}

export default trendsOverviewTour
