import type { LayerDefinition } from '../types'

const metricsHeaderLayer: LayerDefinition = {
  id: 'metrics-header',
  version: 1,
  steps: [
    {
      element: '[data-tour="metrics-section-tabs"]',
      popover: {
        title: 'Analytics Sections',
        description:
          'Registration tracks enrollment numbers, Retention shows who came back, and Trends reveals multi-year patterns.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="metrics-session-selector"]',
      popover: {
        title: 'Session Filter',
        description:
          'Filter by session type, duration, a specific session, or view all. Applies across most tabs.',
        side: 'bottom',
        align: 'end',
      },
    },
  ],
}

export default metricsHeaderLayer
