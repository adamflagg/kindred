import type { TourDefinition } from '../types'

const retentionStaffTour: TourDefinition = {
  id: 'retention-staff',
  version: 1,
  layers: ['metrics-header'],
  steps: [
    {
      element: '[data-tour="retention-staff-table"]',
      popover: {
        title: 'Staff Table',
        description:
          "Each row shows a staff member's cabin retention rates. 'Overall' is the weighted average.",
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="retention-staff-sort-name"]',
      popover: {
        title: 'Sortable Columns',
        description: "Click 'Staff' or 'Overall' headers to sort.",
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="retention-staff-legend"]',
      popover: {
        title: 'Color Coding',
        description: 'Same color coding as bunk heatmap: green (60%+), amber (40-60%), red (<40%).',
        side: 'top',
        align: 'start',
      },
    },
  ],
}

export default retentionStaffTour
