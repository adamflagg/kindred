import type { TourDefinition } from '../types'

const trendsCancellationsTour: TourDefinition = {
  id: 'trends-cancellations',
  version: 1,
  layers: ['metrics-header', 'trends-intro'],
  steps: [
    {
      element: '[data-tour="cancel-velocity-controls"]',
      popover: {
        title: 'Cancellation Controls',
        description:
          'Same controls as enrollment velocity — prior year comparison and gender split. Here they track cancellation patterns.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="cancel-velocity-chart"]',
      popover: {
        title: 'Gross Cancellations',
        description: 'Total cancellations from season start. Shows the raw cancellation volume.',
        side: 'top',
        align: 'start',
        onPopoverRender: () => {
          ;(
            document.querySelector('[data-tour="cancel-velocity-mode-gross"]') as HTMLElement
          )?.click()
        },
      },
    },
    {
      element: '[data-tour="cancel-velocity-chart"]',
      popover: {
        title: 'Net Cancellations',
        description: 'Cancellations adjusted for re-enrollments. The default view.',
        side: 'top',
        align: 'start',
        onPopoverRender: () => {
          ;(
            document.querySelector('[data-tour="cancel-velocity-mode-net"]') as HTMLElement
          )?.click()
        },
      },
    },
    {
      element: '[data-tour="cancel-velocity-chart"]',
      popover: {
        title: 'Weekly Delta',
        description:
          'Week-over-week cancellation changes. Colors are inverted here — red means more cancellations (bad), green means fewer.',
        side: 'top',
        align: 'start',
        onPopoverRender: () => {
          ;(
            document.querySelector('[data-tour="cancel-velocity-mode-delta"]') as HTMLElement
          )?.click()
        },
      },
    },
  ],
  isReady: () => document.querySelector('[data-tour="cancel-velocity-controls"]') !== null,
}

export default trendsCancellationsTour
