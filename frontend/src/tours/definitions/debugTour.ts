import type { TourDefinition } from '../types'

const debugTour: TourDefinition = {
  id: 'debug',
  version: 3,
  layers: [],
  steps: [
    {
      element: '[data-tour="debug-header"]',
      popover: {
        title: 'Debug Tools',
        description:
          'This area lets you analyze and iterate on the AI intent parsing that powers bunk request processing, plus inspect solver runs and the full request pipeline.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="debug-tabs"]',
      popover: {
        title: 'Debug Sections',
        description:
          'Switch between Parse Analysis (inspect how AI parsed each request), Prompt Editor (tweak the AI prompt), Pipeline (full processing trace), and Solver Stats (OR-Tools internals).',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      popover: {
        title: 'Pro Tip: Page Tours',
        description:
          'Every page with a guided tour can be replayed from the Help menu (? icon) in the header. Tours auto-run once on your first visit and re-trigger when the tour is updated.',
      },
    },
  ],
}

export default debugTour
