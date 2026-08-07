/**
 * Roles tab for the admin Users page.
 *
 * Lists all roles with their permissions. System roles show a badge and
 * are not editable unless the user is an admin. Custom roles support full
 * CRUD for admin users.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, Plus, Pencil, Trash2, X, Check, Loader2 } from 'lucide-react'
import { pb } from '../../lib/pocketbase'
import { queryKeys, userDataOptions } from '../../utils/queryKeys'
import { usePermissions } from '../../hooks/usePermissions'
import { ALL_PERMISSIONS } from '../../constants/permissions'
import type { Role } from '../../types/rbac'

interface RoleFormData {
  name: string
  slug: string
  description: string
  permissions: string[]
}

export function RolesTab() {
  const { isAdmin } = usePermissions()
  const queryClient = useQueryClient()
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [formData, setFormData] = useState<RoleFormData>({
    name: '',
    slug: '',
    description: '',
    permissions: [],
  })

  const {
    data: roles = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.roles(),
    queryFn: async () => {
      const records = await pb.collection('roles').getFullList<Role>({
        sort: 'name',
        requestKey: null,
      })
      return records
    },
    ...userDataOptions,
  })

  const createMutation = useMutation({
    mutationFn: async (data: RoleFormData) => {
      return pb.collection('roles').create({
        ...data,
        is_system: false,
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles() })
      setIsCreating(false)
      resetForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RoleFormData> }) => {
      return pb.collection('roles').update(id, data)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles() })
      setEditingRole(null)
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return pb.collection('roles').delete(id)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles() })
    },
  })

  function resetForm() {
    setFormData({ name: '', slug: '', description: '', permissions: [] })
  }

  function startEdit(role: Role) {
    setEditingRole(role)
    setFormData({
      name: role.name,
      slug: role.slug,
      description: role.description,
      permissions: role.permissions,
    })
    setIsCreating(false)
  }

  function startCreate() {
    setIsCreating(true)
    setEditingRole(null)
    resetForm()
  }

  function cancelEdit() {
    setEditingRole(null)
    setIsCreating(false)
    resetForm()
  }

  function handleSave() {
    if (isCreating) {
      createMutation.mutate(formData)
    } else if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, data: formData })
    }
  }

  function togglePermission(perm: string) {
    setFormData((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(perm)
        ? prev.permissions.filter((p) => p !== perm)
        : [...prev.permissions, perm],
    }))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner-lodge" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-800 dark:bg-red-950/30">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load roles</p>
      </div>
    )
  }

  const isEditing = editingRole !== null || isCreating

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="text-primary h-5 w-5" />
          <h2 className="font-display text-foreground text-lg font-bold">Roles</h2>
          <span className="text-muted-foreground text-sm">({roles.length})</span>
        </div>
        {isAdmin && !isEditing && (
          <button onClick={startCreate} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus className="h-4 w-4" />
            New Role
          </button>
        )}
      </div>

      {/* Edit/Create Form */}
      {isEditing && (
        <div className="card-lodge space-y-4 p-4">
          <h3 className="font-display text-foreground font-semibold">
            {isCreating ? 'Create Role' : `Edit: ${editingRole?.name}`}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="role-name" className="text-foreground mb-1 block text-sm font-medium">
                Name
              </label>
              <input
                id="role-name"
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                className="input-lodge w-full"
                placeholder="Role name"
              />
            </div>
            <div>
              <label htmlFor="role-slug" className="text-foreground mb-1 block text-sm font-medium">
                Slug
              </label>
              <input
                id="role-slug"
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData((p) => ({ ...p, slug: e.target.value }))}
                className="input-lodge w-full"
                placeholder="role-slug"
                disabled={editingRole?.is_system}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="role-description"
              className="text-foreground mb-1 block text-sm font-medium"
            >
              Description
            </label>
            <input
              id="role-description"
              type="text"
              value={formData.description}
              onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              className="input-lodge w-full"
              placeholder="What this role is for"
            />
          </div>
          {/* A fieldset/legend, not a <label> — "Permissions" captions a group of
              toggle buttons, not a single associable control. */}
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="text-foreground mb-2 block text-sm font-medium">Permissions</legend>
            <div className="flex flex-wrap gap-2">
              {ALL_PERMISSIONS.map((perm) => (
                <button
                  key={perm}
                  type="button"
                  onClick={() => togglePermission(perm)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    formData.permissions.includes(perm)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                  }`}
                >
                  {perm}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={
                createMutation.isPending ||
                updateMutation.isPending ||
                !formData.name ||
                !formData.slug
              }
              className="btn-primary flex items-center gap-1.5 text-sm"
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {isCreating ? 'Create' : 'Save'}
            </button>
            <button onClick={cancelEdit} className="btn-ghost flex items-center gap-1.5 text-sm">
              <X className="h-4 w-4" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Roles List */}
      {roles.length === 0 ? (
        <div className="bg-card border-border rounded-xl border p-8 text-center">
          <Shield className="text-muted-foreground/50 mx-auto mb-4 h-10 w-10" />
          <p className="text-muted-foreground text-sm">No roles defined yet</p>
        </div>
      ) : (
        <div className="bg-card border-border divide-border divide-y overflow-hidden rounded-xl border shadow-sm">
          {roles.map((role) => (
            <div
              key={role.id}
              className="hover:bg-muted/50 dark:hover:bg-muted/30 flex items-start gap-3 px-4 py-3 transition-colors sm:items-center sm:px-5 sm:py-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground text-sm font-medium sm:text-base">
                    {role.name}
                  </span>
                  {role.is_system && (
                    <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      System
                    </span>
                  )}
                </div>
                {role.description && (
                  <p className="text-muted-foreground mt-0.5 text-xs">{role.description}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1">
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
              {isAdmin && !isEditing && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(role)}
                    className="btn-ghost text-muted-foreground hover:text-foreground p-1.5"
                    title="Edit role"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {!role.is_system && (
                    <button
                      onClick={() => {
                        if (confirm(`Delete role "${role.name}"?`)) {
                          deleteMutation.mutate(role.id)
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      className="btn-ghost p-1.5 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      title="Delete role"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
