import type { LayerDefinition } from '../types'

const trendsIntroLayer: LayerDefinition = {
  id: 'trends-intro',
  version: 1,
  steps: [
    {
      element: '[data-tour="metrics-expanded-analysis"]',
      disableActiveInteraction: false,
      popover: {
        title: 'Expanded Analysis',
        description:
          'Adds detailed breakdowns below each chart — geographic top-15 lists, grade distributions, and more. Toggle it to see the difference.',
        side: 'bottom',
        align: 'end',
      },
    },
  ],
}

export default trendsIntroLayer
