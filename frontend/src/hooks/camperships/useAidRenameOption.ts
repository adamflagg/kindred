import { useMutation, useQueryClient } from '@tanstack/react-query'

import { renameAidScenarioOption } from '../../services/camperships/aidApi'
import type { ApiAidScenarioOption } from '../../types/api-types'
import { invalidateAidScenarioQueries } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'

/** Rename a kept option (§S5 D; §S11.1). Kept options are shared, so the scenario reads refresh on settle. */
export function useAidRenameOption() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useMutation<ApiAidScenarioOption, Error, { code: string; name: string }>({
    mutationFn: ({ code, name }) => renameAidScenarioOption(fetchWithAuth, year, code, { name }),
    onSettled: () => invalidateAidScenarioQueries(queryClient),
  })
}
