import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { pipelineDebugService } from '../services/pipelineDebug'

export function useOriginalRequestsByCamper(cmId: number | null, year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.originalRequestsByCamper(cmId ?? 0, year),
    queryFn: () => pipelineDebugService.fetchOriginalRequestsByCamper(cmId!, year, fetchWithAuth),
    enabled: cmId !== null && cmId > 0,
    ...userDataOptions,
  })
}
