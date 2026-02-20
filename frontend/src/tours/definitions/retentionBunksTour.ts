import type { TourDefinition } from '../types'

const retentionBunksTour: TourDefinition = {
  id: 'retention-bunks',
  version: 1,
  steps: [
    {
      element: '[data-tour="retention-bunks-heatmap"]',
      popover: {
        title: 'Bunk Heatmap',
        description:
          'Each cell shows what percentage of campers from that bunk returned this year.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="retention-bunks-legend"]',
      popover: {
        title: 'Color Legend',
        description: 'Green = 60%+, amber = 40-60%, red = <40%.',
        side: 'top',
        align: 'start',
      },
    },
    {
      popover: {
        title: 'Cabin Areas',
        description: 'Split by Boys, Girls, and All-Gender cabin areas.',
      },
    },
  ],
  hints: [
    {
      element: '[data-tour="retention-bunks-heatmap"]',
      title: 'Hover for Details',
      description: 'Hover any cell to see exact numbers and staff assigned to that bunk.',
    },
  ],
  isReady: () => {
    return document.querySelector('[data-tour="retention-bunks-heatmap"]') !== null
  },
}

export default retentionBunksTour
