import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'
import type { AdminSetting } from './useAdminSettings'

interface UpdateAdminSettingParams {
  key: string
  value: string
}

export function useUpdateAdminSetting() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ key, value }: UpdateAdminSettingParams) => {
      // Find the setting by key
      const settings = await pb.collection<AdminSetting>('admin_settings').getFullList({
        filter: `key = "${key}"`,
      })

      if (settings.length === 0) {
        throw new Error(`Setting key "${key}" not found`)
      }

      const setting = settings[0]
      if (!setting) {
        throw new Error(`Setting key "${key}" not found`)
      }

      // Update the setting
      return await pb.collection<AdminSetting>('admin_settings').update(setting.id, {
        value: value,
      })
    },
    onSuccess: () => {
      // Invalidate admin settings query to refetch
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminSettings() })
    },
  })
}
