import { useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '../../../lib/pocketbase'
import { queryKeys } from '../../../utils/queryKeys'

/**
 * Saves a person's role draft in one PocketBase batch (spec U10b): all of it or
 * none. Batch is enabled by 1500000195_batch_settings.js; each sub-request still
 * passes user_roles' rule, recomputes cached_permissions in the transaction, and
 * audits as its own row.
 */
export function useSaveUserRoles() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      userId,
      add,
      remove,
    }: {
      userId: string
      add: string[]
      remove: string[]
    }) => {
      const batch = pb.createBatch()
      for (const role of add) batch.collection('user_roles').create({ user: userId, role })
      for (const linkId of remove) batch.collection('user_roles').delete(linkId)
      await batch.send()
    },
    onSuccess: (_r, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.userRoles() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.userRolesForUser(userId) })
    },
  })
}
