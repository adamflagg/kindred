/**
 * A season's registration dates, as staff enter them in Admin › Registration Dates
 * (config rows: category "registration", subcategory = the year).
 *
 * Two readers share one query key: the admin screen, and Analytics' empty season, whose second
 * line names the priority date. A save in Admin invalidates the key, so both refresh.
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import type { ConfigRecord } from '../types/pocketbase-types'

export function useRegistrationDates(year: number) {
  return useQuery({
    queryKey: queryKeys.registrationDatesConfig(year),
    ...userDataOptions,
    queryFn: async () => {
      const records = await pb.collection('config').getFullList<ConfigRecord>({
        filter: `category = "registration" && subcategory = "${year}"`,
        sort: 'config_key',
      })
      return records
    },
    enabled: year > 0,
  })
}

/** The season's priority registration date as stored (`YYYY-MM-DD…`), or undefined when unset. */
export function usePriorityRegDate(year: number): string | undefined {
  const { data } = useRegistrationDates(year)
  const value = data?.find((r) => r.config_key === 'priority_reg_date')?.value
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** "2026-11-11" (any time part ignored) → "Wednesday, Nov 11"; null if it is not a date. */
export function formatPriorityDate(stored: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(stored)
  if (!m) return null
  // A calendar day, not an instant: build it in local time so no timezone shifts the weekday.
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}
