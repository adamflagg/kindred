/**
 * Derive a stable slug from the display name.
 *
 * `code` is a real join key — `bathroom_group` membership matches on codes and
 * the roster keys on `unit_code` — so it is generated once on create and only
 * editable behind a disclosure. Renaming an existing code is not safe.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
