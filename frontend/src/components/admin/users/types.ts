import type { UseQueryResult } from '@tanstack/react-query'
import type { ApiPermissionRegistry } from '../../../types/api-types'
import type { useUsersPageData } from './useUsersPageData'
import type { useUsersPageUrl } from './useUsersPageUrl'

export type UsersPageData = ReturnType<typeof useUsersPageData>
export interface UsersPageProps {
  data: UsersPageData
  registry: UseQueryResult<ApiPermissionRegistry>
  url: ReturnType<typeof useUsersPageUrl>
}
