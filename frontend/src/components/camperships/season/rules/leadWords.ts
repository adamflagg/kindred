/** The frozen fact (spec §6.2 B): what approving does, or where an edit goes. */
export function frozenFact(
  show: 'draft' | 'approved',
  draftVersion: number,
  approvedVersion: number | null
): string {
  if (approvedVersion === null)
    return `nothing in effect yet · approving puts v${String(draftVersion)} in effect`
  if (approvedVersion === draftVersion)
    return `frozen · an edit starts v${String(draftVersion + 1)}`
  return show === 'draft'
    ? `v${String(approvedVersion)} is frozen · approving puts v${String(draftVersion)} in effect`
    : `frozen · edits go to draft v${String(draftVersion)}`
}
