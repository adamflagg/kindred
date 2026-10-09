import { useQuery } from '@tanstack/react-query'

import { columnParam, type AsOfPick } from '../../components/camperships/reports/developmentModel'
import { canOpenCamperships } from '../../config/programAccess'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidDevelopment } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { reportRetry } from './reportRetry'

const NO_PARAMS: Readonly<Record<string, string>> = {}

/**
 * Reports › Development's one read (spec §9.4; D65, D87–D94): live only. `view` or `summary`: development
 * reads it with no `view` (D65). `column` asks for one on-demand dated column (a season as of a past
 * day, recomputed from dated records, saved nowhere); it comes back among `columns`.
 */
export function useAidDevelopment(column?: AsOfPick | null) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const asked = column ? columnParam(column) : undefined
  return useQuery({
    queryKey: queryKeys.aidReport(
      year,
      'development',
      asked === undefined ? NO_PARAMS : { column: asked }
    ),
    queryFn: () => fetchAidDevelopment(fetchWithAuth, year, asked),
    enabled: year > 0 && !authLoading && canOpenCamperships({ hasPermission }),
    retry: reportRetry,
  })
}
