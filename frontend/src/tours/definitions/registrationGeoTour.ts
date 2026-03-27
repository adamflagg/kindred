import type { TourDefinition } from '../types'

const registrationGeoTour: TourDefinition = {
  id: 'registration-geo',
  version: 1,
  layers: ['metrics-header', 'registration-intro'],
  steps: [
    {
      element: '[data-tour="reg-geo-layers"]',
      disableActiveInteraction: false,
      popover: {
        title: 'Layer Toggles',
        description:
          'Show or hide city, school, synagogue, and region layers. Try toggling them to focus on what matters.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="reg-geo-map"]',
      popover: {
        title: 'Geographic Map',
        description:
          'Interactive map showing where campers come from. When comparison mode is on, this switches to a side-by-side list.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="reg-geo-details"]',
      popover: {
        title: 'Detail Lists',
        description:
          'Expandable lists by category. Click any heading to collapse or expand. Numbers show enrollment counts.',
        side: 'top',
        align: 'start',
      },
    },
  ],
}

export default registrationGeoTour
