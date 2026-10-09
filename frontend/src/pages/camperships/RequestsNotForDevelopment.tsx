import { Link } from 'react-router'

import { aidHref } from '../../components/camperships/kit/asOf'
import { CS_LINK } from '../../components/camperships/kit/csType'
import { useAidAsOf } from '../../hooks/camperships/useAidAsOf'
import { useYear } from '../../hooks/useCurrentYear'

/**
 * What the development persona sees at /aid/requests (owner ★9; the mock's `!CF.can('view')`): one card in
 * staff words instead of "Access Restricted", with the places development works from. The route still
 * demands financial_aid.view; this only replaces the dead end.
 */
export default function RequestsNotForDevelopment() {
  const year = useYear()
  const asOf = useAidAsOf()
  const to = (path: string) => aidHref(path, { year, asOf })
  return (
    <div className="border-border bg-card text-muted-foreground mx-auto my-6 max-w-5xl rounded-xl border border-dashed px-4 py-3.5 text-[13.5px] leading-normal">
      <b className="text-foreground">Requests isn&apos;t part of the development view.</b>{' '}
      Development works from{' '}
      <Link className={CS_LINK} to={to('/aid/reports/development')}>
        Reports › Development
      </Link>
      ,{' '}
      <Link className={CS_LINK} to={to('/aid/reports/zip-codes')}>
        ZIP codes
      </Link>{' '}
      and{' '}
      <Link className={CS_LINK} to={to('/aid/money/funders')}>
        Money › Funders
      </Link>
      .
    </div>
  )
}
