import type { TourDefinition } from '../types'

const registrationOverviewTour: TourDefinition = {
  id: 'registration-overview',
  version: 1,
  layers: ['metrics-header', 'registration-intro'],
  steps: [
    {
      element: '[data-tour="reg-overview-summary"]',
      popover: {
        title: 'Registration Summary',
        description:
          'Key enrollment metrics at a glance — total enrolled, waitlisted, cancelled, new campers, and returning campers. Click any card to drill down into the individual campers.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="reg-overview-demographics"]',
      popover: {
        title: 'Demographic Breakdowns',
        description:
          'Charts show gender, grade, session, and experience distributions. Click any bar or segment to see the campers behind the numbers.',
        side: 'top',
        align: 'start',
      },
    },
    {
      element: '[data-tour="reg-overview-session-table"]',
      popover: {
        title: 'Session Details',
        description:
          'Per-session breakdown with utilization percentages. Green means 90%+ capacity, red means over-enrolled.',
        side: 'top',
        align: 'start',
      },
    },
  ],
  isReady: () => document.querySelector('[data-tour="reg-overview-summary"]') !== null,
}

export default registrationOverviewTour
