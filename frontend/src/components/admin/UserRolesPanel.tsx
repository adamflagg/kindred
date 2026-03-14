/**
 * Slide-out panel for assigning roles to a user.
 *
 * Fetches all available roles and the user's current role assignments,
 * then allows toggling roles on/off via checkboxes. Each toggle creates
 * or deletes a `user_roles` record in PocketBase, which triggers the
 * Go hook to recompute `cached_permissions`.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Loader2, Shield } from 'lucide-react'
import { pb } from '../../lib/pocketbase'
import { queryKeys, userDataOptions } from '../../utils/queryKeys'
import type { RecordModel } from 'pocketbase'
import type { Role, UserRole } from '../../types/rbac'

interface UserRolesPanelProps {
  user: RecordModel
  onClose: () => void
}

export function UserRolesPanel({ user, onClose }: UserRolesPanelProps) {
  const queryClient = useQueryClient()

  const { data: roles = [], isLoading: rolesLoading } = useQuery({
    queryKey: queryKeys.roles(),
    queryFn: async () => {
      return pb.collection('roles').getFullList<Role>({
        sort: 'name',
        requestKey: null,
      })
    },
    ...userDataOptions,
  })

  const { data: userRoles = [], isLoading: userRolesLoading } = useQuery({
    queryKey: queryKeys.userRolesForUser(user.id),
    queryFn: async () => {
      return pb.collection('user_roles').getFullList<UserRole>({
        filter: `user = "${user.id}"`,
        requestKey: null,
      })
    },
    ...userDataOptions,
  })

  const assignedRoleIds = new Set(userRoles.map((ur) => ur.role))

  const assignMutation = useMutation({
    mutationFn: async (roleId: string) => {
      return pb.collection('user_roles').create({
        user: user.id,
        role: roleId,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.userRolesForUser(user.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.userRoles() })
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (userRoleId: string) => {
      return pb.collection('user_roles').delete(userRoleId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.userRolesForUser(user.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.userRoles() })
    },
  })

  function handleToggleRole(roleId: string) {
    if (assignedRoleIds.has(roleId)) {
      const userRole = userRoles.find((ur) => ur.role === roleId)
      if (userRole) {
        removeMutation.mutate(userRole.id)
      }
    } else {
      assignMutation.mutate(roleId)
    }
  }

  const isLoading = rolesLoading || userRolesLoading
  const isMutating = assignMutation.isPending || removeMutation.isPending
  const userName = (user['name'] as string) || (user['email'] as string) || 'User'

  return (
    <div className="card-lodge space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="text-primary h-5 w-5" />
          <div>
            <h3 className="font-display text-foreground font-semibold">{userName}</h3>
            <p className="text-muted-foreground text-xs">Manage role assignments</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="btn-ghost text-muted-foreground hover:text-foreground p-1.5"
          title="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="spinner-lodge" />
        </div>
      ) : roles.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">No roles available</p>
      ) : (
        <div className="space-y-2">
          {roles.map((role) => {
            const isAssigned = assignedRoleIds.has(role.id)
            return (
              <label
                key={role.id}
                className="border-border hover:bg-muted/50 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={isAssigned}
                  onChange={() => handleToggleRole(role.id)}
                  disabled={isMutating}
                  data-role-id={role.id}
                  className="accent-primary mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-sm font-medium">{role.name}</span>
                    {role.is_system && (
                      <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                        System
                      </span>
                    )}
                  </div>
                  {role.description && (
                    <p className="text-muted-foreground mt-0.5 text-xs">{role.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {role.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-xs"
                      >
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>
                {isMutating && <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
