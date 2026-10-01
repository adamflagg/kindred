import { useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { parseAsOf, type AidAsOf } from '../../components/camperships/kit/asOf'
import { campToday } from '../../components/camperships/kit/dates'

/** The page's as-of, read from its URL (D15). */
export function useAidAsOf(): AidAsOf {
  const [params] = useSearchParams()
  const raw = params.get('as_of')
  const axis = params.get('as_of_axis')
  return useMemo(() => parseAsOf(raw, axis, campToday()), [raw, axis])
}
