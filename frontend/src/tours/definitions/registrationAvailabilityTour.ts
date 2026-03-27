import type { TourDefinition } from '../types'

const registrationAvailabilityTour: TourDefinition = {
  id: 'registration-availability',
  version: 1,
  layers: ['metrics-header', 'registration-intro'],
  steps: [
    {
      element: '[data-tour="reg-availability-heatmap"]',
      popover: {
        title: 'Availability Matrix',
        description:
          'Grade-by-gender grid showing session capacity status. Each cell shows enrolled count vs available spots.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="reg-availability-legend"]',
      popover: {
        title: 'Status Colors',
        description:
          'Green = open spots, amber = limited availability, red = full or over-enrolled, gray = not applicable for that grade/gender.',
        side: 'top',
        align: 'start',
      },
    },
  ],
  isReady: () => document.querySelector('[data-tour="reg-availability-heatmap"]') !== null,
}

export default registrationAvailabilityTour
