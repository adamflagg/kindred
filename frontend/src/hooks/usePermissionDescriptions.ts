import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import type { OverrideWrite } from '../components/admin/users/usersPageModel'
import { queryKeys } from '../utils/queryKeys'

export interface PermissionOverride {
  id: string
  codename: string
  description: string
  base_description: string
}

/** Admin wording overrides (spec §3.2). Inherits the app's default caching. */
export function usePermissionDescriptions() {
  return useQuery({
    queryKey: queryKeys.permissionDescriptions(),
    queryFn: () =>
      pb
        .collection('permission_descriptions')
        .getFullList<PermissionOverride>({ requestKey: null }),
  })
}

/** Writes one override change. Admin-only by collection rule; audited as `roles`. */
export function useSaveDescription() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (write: OverrideWrite): Promise<void> => {
      const col = pb.collection('permission_descriptions')
      if (write.kind === 'create') {
        await col.create({
          codename: write.codename,
          description: write.description,
          base_description: write.base_description,
        })
      } else if (write.kind === 'update') {
        await col.update(write.id, {
          description: write.description,
          base_description: write.base_description,
        })
      } else if (write.kind === 'delete') {
        await col.delete(write.id)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.permissionDescriptions() })
    },
  })
}
