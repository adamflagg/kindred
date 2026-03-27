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
          'Expands the trends data from 3 years to 5 years, giving a wider historical window. Toggle it to see more seasons.',
        side: 'bottom',
        align: 'end',
      },
    },
  ],
}

export default trendsIntroLayer
