import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  ledgerParams,
  type LedgerFilters,
} from '../../components/camperships/money/ledgerFamiliesModel'
import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidMoneyLedger } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { useAidAsOf } from './useAidAsOf'

/**
 * Money › Ledger's family read (spec §8.1; D26, D151; P-22): one row per family, live or by the
 * page's past day and axis, filtered by the server. Under the ledger prefix: every Camperships
 * write refreshes it (a placement moves a level), and a ledger sync through 'financial-aid'.
 */
export function useAidMoneyLedger(filters: LedgerFilters) {
  const year = useYear()
  const asOf = useAidAsOf()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const params = ledgerParams(filters, asOf)
  return useQuery({
    queryKey: queryKeys.aidMoneyLedger(year, new URLSearchParams(params).toString()),
    queryFn: () => fetchAidMoneyLedger(fetchWithAuth, year, params),
    enabled: year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    // R3-4: a filter change is a new key; keep the last rows on screen while it loads, as History
    // and Scenarios do on main (`useAidHistoryPages`, `useAidScenarioCompare`).
    placeholderData: keepPreviousData,
  })
}
