import type { TourDefinition } from '../types'

const registrationForecastTour: TourDefinition = {
  id: 'registration-forecast',
  version: 1,
  layers: ['metrics-header', 'registration-intro'],
  steps: [
    {
      element: '[data-tour="reg-forecast-snapshot"]',
      disableActiveInteraction: false,
      popover: {
        title: 'Snapshot Date',
        description:
          'Select a point-in-time snapshot to see what enrollment looked like on that date. Useful for comparing registration pace.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="reg-forecast-table"]',
      popover: {
        title: 'Forecast Table',
        description:
          'Shows goal, enrolled, waitlist, and revenue per session. Columns compare against budget and prior year. Green = ahead of target.',
        side: 'top',
        align: 'start',
      },
    },
  ],
  isReady: () => document.querySelector('[data-tour="reg-forecast-snapshot"]') !== null,
}

export default registrationForecastTour
