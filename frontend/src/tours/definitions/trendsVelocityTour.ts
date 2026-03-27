import type { TourDefinition } from '../types'

const trendsVelocityTour: TourDefinition = {
  id: 'trends-velocity',
  version: 1,
  layers: ['metrics-header'],
  steps: [
    {
      element: '[data-tour="velocity-controls"]',
      popover: {
        title: 'Velocity Controls',
        description:
          'Compare against prior years, split by gender, and switch between chart types. When gender split is on, only one prior year can be selected.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="velocity-chart"]',
      popover: {
        title: 'Gross Cumulative',
        description:
          'Total enrollment from season start, not accounting for cancellations. Shows the raw demand signal.',
        side: 'top',
        align: 'start',
        onPopoverRender: () => {
          document.querySelector<HTMLElement>('[data-tour="velocity-mode-gross"]')?.click()
        },
      },
    },
    {
      element: '[data-tour="velocity-chart"]',
      popover: {
        title: 'Net Cumulative',
        description:
          'Enrollment minus cancellations — the real enrollment picture. This is the default view.',
        side: 'top',
        align: 'start',
        onPopoverRender: () => {
          document.querySelector<HTMLElement>('[data-tour="velocity-mode-net"]')?.click()
        },
      },
    },
    {
      element: '[data-tour="velocity-chart"]',
      popover: {
        title: 'Weekly Delta',
        description:
          'Week-over-week enrollment changes. Positive = new enrollments outpacing cancellations. Phase markers switch to dashed lines in this view.',
        side: 'top',
        align: 'start',
        onPopoverRender: () => {
          document.querySelector<HTMLElement>('[data-tour="velocity-mode-delta"]')?.click()
        },
      },
    },
    {
      popover: {
        title: 'Brush Zoom',
        description:
          'Drag the handles at the bottom of the chart to zoom into a specific time period. The week-range dropdowns stay in sync.',
      },
    },
  ],
}

export default trendsVelocityTour
