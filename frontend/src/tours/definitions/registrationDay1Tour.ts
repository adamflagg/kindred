import type { TourDefinition } from '../types'

const registrationDay1Tour: TourDefinition = {
  id: 'registration-day1',
  version: 2,
  layers: ['metrics-header', 'registration-intro'],
  steps: [
    {
      element: '[data-tour="reg-day1-summary"]',
      popover: {
        title: 'Day 1 Metrics',
        description:
          'Shows sign-ups in the first two days of each registration phase — priority, early, and open — against the same days in prior years.',
        side: 'bottom',
        align: 'start',
      },
    },
  ],
}

export default registrationDay1Tour
