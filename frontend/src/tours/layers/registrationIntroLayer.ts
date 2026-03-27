import type { LayerDefinition } from '../types'

const registrationIntroLayer: LayerDefinition = {
  id: 'registration-intro',
  version: 1,
  steps: [
    {
      element: '[data-tour="metrics-compare-year"]',
      disableActiveInteraction: false,
      popover: {
        title: 'Year-over-Year Comparison',
        description:
          "Toggle to overlay a prior year's data side by side. Available on most Registration tabs. Try clicking it.",
        side: 'bottom',
        align: 'end',
      },
    },
  ],
}

export default registrationIntroLayer
