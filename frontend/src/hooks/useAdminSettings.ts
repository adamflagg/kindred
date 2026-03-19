import { useQuery } from '@tanstack/react-query'
import type { RecordModel } from 'pocketbase'
import { pb } from '../lib/pocketbase'
import { useAuth } from '../contexts/AuthContext'
import { queryKeys, userDataOptions } from '../utils/queryKeys'

export interface AdminSetting extends RecordModel {
  key: string
  value: unknown
  description?: string
}

export function useAdminSettings() {
  const { isLoading } = useAuth()
  return useQuery<AdminSetting[]>({
    queryKey: queryKeys.adminSettings(),
    queryFn: async () => {
      const settings = await pb.collection<AdminSetting>('admin_settings').getFullList({
        sort: 'key',
      })

      return settings
    },
    ...userDataOptions,
    enabled: !isLoading,
  })
}
