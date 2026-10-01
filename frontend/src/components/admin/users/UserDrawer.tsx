import type { RecordModel } from 'pocketbase'
import type { UsersPageProps } from './types'

interface UserDrawerProps {
  user: RecordModel
  data: UsersPageProps['data']
  registry: UsersPageProps['registry']
  onClose: () => void
}

// Stub, replaced by Task 10 of the Users page uplift.
export function UserDrawer(_props: UserDrawerProps) {
  return <div data-testid="user-drawer-placeholder" />
}
