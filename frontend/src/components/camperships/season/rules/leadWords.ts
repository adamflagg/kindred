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

/**
 * What a receipt's rules line says on hover (final mock RCPT_T): which version this is and why it can differ from the
 * rules in effect. `words` is `versionWords`' line ("Rules v3 · approved Oct 8, 2026"); its date, if any, is quoted.
 */
export function receiptTitle(version: number, words: string): string {
  const on = /· approved (.+)$/.exec(words)?.[1]
  return `You came from a receipt: this is rules v${String(version)} exactly as it was approved${on === undefined ? '' : ` on ${on}`}, the version that priced it. Later approvals don't change it.`
}
