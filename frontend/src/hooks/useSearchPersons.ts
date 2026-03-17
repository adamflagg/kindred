import { useQuery } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, userDataOptions } from '../utils/queryKeys'
import { pipelineDebugService } from '../services/pipelineDebug'

export function useSearchPersons(query: string, year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery({
    queryKey: queryKeys.searchPersons(query, year),
    queryFn: () => pipelineDebugService.searchPersons(query, year, fetchWithAuth),
    enabled: query.length >= 2,
    ...userDataOptions,
  })
}
