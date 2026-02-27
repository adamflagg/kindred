import type { TourDefinition } from '../types'

const retentionFlowTour: TourDefinition = {
  id: 'retention-flow',
  version: 1,
  steps: [
    {
      element: '[data-tour="retention-flow-sankey"]',
      popover: {
        title: 'Session Flow',
        description:
          'Shows how campers flow between sessions year-over-year. Each band represents campers moving from one session to another.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      popover: {
        title: 'Hover for Details',
        description:
          'Hover any flow band to see exact camper counts. Thicker bands mean more campers.',
      },
    },
  ],
  isReady: () => {
    return document.querySelector('[data-tour="retention-flow-sankey"]') !== null
  },
}

export default retentionFlowTour
