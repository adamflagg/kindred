import type { TourDefinition } from '../types'

const debugTour: TourDefinition = {
  id: 'debug',
  version: 1,
  steps: [
    {
      element: '[data-tour="debug-header"]',
      popover: {
        title: 'Debug Tools',
        description:
          'This page lets you analyze and iterate on the AI intent parsing that powers bunk request processing. Use it to inspect how camper requests are interpreted.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="debug-tabs"]',
      popover: {
        title: 'Tool Tabs',
        description:
          'Switch between Parse Analysis (inspect how AI parsed each request) and Prompt Editor (tweak the AI prompt and test changes in real time).',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="debug-content"]',
      popover: {
        title: 'Analysis Area',
        description:
          'Results appear here. In Parse Analysis, you can filter by session, search by camper name, and drill into individual parse results to see confidence scores.',
        side: 'top',
        align: 'start',
      },
    },
    {
      popover: {
        title: 'Pro Tip: Page Tours',
        description:
          'Every page with a guided tour has a "Tour" button in the header. Click it anytime to replay the tour. Tours auto-run once on your first visit and re-trigger when features change.',
      },
    },
  ],
  isReady: () => {
    return document.querySelector('[data-tour="debug-header"]') !== null
  },
}

export default debugTour
