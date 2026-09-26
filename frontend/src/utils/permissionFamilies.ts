/**
 * Groups permission codenames by family — the part before the dot — keeping
 * their order. `financial_aid.view` and `financial_aid.rules` share the
 * `financial_aid` family. Used by the View as Custom picker.
 */
export interface PermissionFamily {
  family: string
  permissions: string[]
}

export function groupPermissions(all: readonly string[]): PermissionFamily[] {
  const families: PermissionFamily[] = []
  for (const perm of all) {
    const family = perm.split('.')[0] ?? perm
    const last = families.at(-1)
    if (last?.family === family) last.permissions.push(perm)
    else families.push({ family, permissions: [perm] })
  }
  return families
}
