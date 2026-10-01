import type { UsersPageData, UsersPageProps } from './types'

interface RoleDrawerProps {
  /** null means creating a new role. */
  roleId: string | null
  data: UsersPageData
  registry: UsersPageProps['registry']
  onClose: () => void
}

// Stub, replaced in a later task of the Users page uplift.
export function RoleDrawer(_props: RoleDrawerProps) {
  return null
}
