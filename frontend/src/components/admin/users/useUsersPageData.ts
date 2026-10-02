import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RecordModel } from 'pocketbase'
import { pb } from '../../../lib/pocketbase'
import { queryKeys, userDataOptions } from '../../../utils/queryKeys'
import { useRoles } from '../../../hooks/useRoles'
import { isViewAsPersonaUser } from '../../../auth/viewAs'
import type { UserRole } from '../../../types/rbac'
import { rolesByUser, type RoleLike } from './usersPageModel'

/** The page's three reads, shared by every tab so their counts agree (spec §3.3–3.4). */
export function useUsersPageData() {
  const usersQ = useQuery({
    queryKey: queryKeys.users(),
    queryFn: async () => {
      const result = await pb
        .collection('users')
        .getList<RecordModel>(1, 1000, { sort: 'name', requestKey: null })
      // PocketBase serves admin previews as stand-in users; they are not people.
      return result.items.filter((u) => !isViewAsPersonaUser({ email: u['email'] }))
    },
    ...userDataOptions,
  })
  const rolesQ = useRoles()
  const linksQ = useQuery({
    queryKey: queryKeys.userRoles(),
    queryFn: () => pb.collection('user_roles').getFullList<UserRole>({ requestKey: null }),
    ...userDataOptions,
  })
  const users = useMemo(() => usersQ.data ?? [], [usersQ.data])
  const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data])
  const userRoles = useMemo(() => linksQ.data ?? [], [linksQ.data])
  const roleLikes: RoleLike[] = useMemo(
    () => roles.map((r) => ({ id: r.id, slug: r.slug, name: r.name, permissions: r.permissions })),
    [roles]
  )
  const held = useMemo(
    () =>
      rolesByUser(
        users.map((u) => ({ id: u.id, is_admin: Boolean(u['is_admin']) })),
        userRoles,
        roleLikes
      ),
    [users, userRoles, roleLikes]
  )
  return {
    users,
    roles,
    roleLikes,
    userRoles,
    held,
    isLoading: usersQ.isLoading || rolesQ.isLoading || linksQ.isLoading,
    error: usersQ.error ?? rolesQ.error ?? linksQ.error,
    refetch: () => {
      void usersQ.refetch()
      void rolesQ.refetch()
      void linksQ.refetch()
    },
  }
}
