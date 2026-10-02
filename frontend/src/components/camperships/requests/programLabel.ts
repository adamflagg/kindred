import type { ApiAidApprovedRules } from '../../../types/api-types'

/**
 * Program words come from the rules, never from this app: each rules program names itself
 * (`ProgramProfile.label`), and the approved-rules read sends them in its `programs` section.
 * Pool names are the same rule, from the Remaining read.
 */
export function programLabels(rules: ApiAidApprovedRules | undefined): Record<string, string> {
  const content = rules?.sections.find((s) => s.section === 'programs')?.content
  const labels: Record<string, string> = {}
  for (const [key, profile] of Object.entries(content ?? {})) {
    if (typeof profile !== 'object' || profile === null) continue
    const label = (profile as { label?: unknown }).label
    if (typeof label === 'string') labels[key] = label
  }
  return labels
}

/**
 * A program key in words: the rules' label when they name it. While the read loads, after it
 * fails or 404s ("no rules yet"), or for a key the rules do not name, the key spelled out:
 * underscores become spaces, first letter capital.
 */
export function programLabel(labels: Readonly<Record<string, string>>, key: string): string {
  const named = labels[key]
  if (named !== undefined) return named
  const spaced = key.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
