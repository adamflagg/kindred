import type { ReactNode } from 'react'

/**
 * The head of an /aid page (the mock's .cf-band + .cf-tabs): the band, 4px, the tab row. The page
 * root spaces what follows at 10px (space-y-2.5). Requests has no tab row: its stage strip sits
 * 12px under the band, so the band keeps 2px and the root's 10px finishes the gap.
 */
export function AidPageHead({ band, tabs }: { band: ReactNode; tabs?: ReactNode }) {
  return (
    <div data-testid="aid-page-head">
      <div className={tabs === undefined ? 'mb-0.5' : 'mb-1'}>{band}</div>
      {tabs}
    </div>
  )
}
