import type { TourDefinition } from '../types'

const registrationCancellationsTour: TourDefinition = {
  id: 'registration-cancellations',
  version: 1,
  layers: ['metrics-header', 'registration-intro'],
  steps: [
    {
      element: '[data-tour="reg-cancel-summary"]',
      popover: {
        title: 'Cancellation Summary',
        description:
          'Tracks total cancellations, whether they were enrolled or waitlisted, and how many re-enrolled in other sessions.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="reg-cancel-timing"]',
      popover: {
        title: 'Timing Insights',
        description:
          'Shows when cancellations happen — average days to cancel, peak cancellation months, and distribution patterns.',
        side: 'top',
        align: 'start',
      },
    },
  ],
}

export default registrationCancellationsTour
