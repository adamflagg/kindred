import type { TourDefinition } from '../types'

const retentionBunksTour: TourDefinition = {
  id: 'retention-bunks',
  version: 1,
  layers: ['metrics-header'],
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
  isReady: () => {
    return document.querySelector('[data-tour="retention-bunks-heatmap"]') !== null
  },
}

export default retentionBunksTour
