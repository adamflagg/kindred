import type { TourDefinition } from '../types'

const registrationDay1Tour: TourDefinition = {
  id: 'registration-day1',
  version: 1,
  layers: ['metrics-header', 'registration-intro'],
  steps: [
    {
      element: '[data-tour="reg-day1-summary"]',
      popover: {
        title: 'Day 1 Metrics',
        description:
          'Shows enrollment milestones by registration phase — priority, early, and open. Tracks how quickly sessions fill during each phase.',
        side: 'bottom',
        align: 'start',
      },
    },
  ],
  isReady: () => document.querySelector('[data-tour="reg-day1-summary"]') !== null,
}

export default registrationDay1Tour
