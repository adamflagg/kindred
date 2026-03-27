import type { TourDefinition } from '../types'

const registrationWaitlistTour: TourDefinition = {
  id: 'registration-waitlist',
  version: 1,
  layers: ['metrics-header', 'registration-intro'],
  steps: [
    {
      element: '[data-tour="reg-waitlist-summary"]',
      popover: {
        title: 'Waitlist Summary',
        description:
          'Tracks total waitlisted, how many have enrollment in other sessions, and outcomes (accepted vs declined).',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="reg-waitlist-sessions"]',
      popover: {
        title: 'Session Breakdown',
        description:
          'Shows waitlist volume per session. Stacked bars break down by current status.',
        side: 'top',
        align: 'start',
      },
    },
  ],
}

export default registrationWaitlistTour
