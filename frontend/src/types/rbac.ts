import type { RecordModel } from 'pocketbase'

export interface Role extends RecordModel {
  name: string
  slug: string
  description: string
  permissions: string[]
  is_system: boolean
}

export interface UserRole extends RecordModel {
  user: string
  role: string
}
