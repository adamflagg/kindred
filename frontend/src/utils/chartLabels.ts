/**
 * Shorter axis labels for the Retention charts (P-20, epic #3207).
 *
 * The owner chose option B, "Shorter names", on the P-20 mock (2026-10-15): the
 * charts keep their angled, 80px-capped axis, and the text gets shorter instead.
 * Only the AXIS text changes. The tooltip, the drill-down filter and its title,
 * and Notable Changes all keep the full name.
 *
 * Sessions use `sessionName(..., 'short')`. Schools and synagogues use the fixed
 * rules below, which are the ones the approved mock states on its page.
 */

/**
 * A school's chart name: drop a trailing " School" (also one just before an
 * "of ..." qualifier), write Community as "Comm.", Preparatory as "Prep" and
 * International as "Intl.", then drop a trailing "of ..." qualifier.
 */
export function schoolChartName(name: string): string {
  const short = name
    .replace(/\s+School(?=\s+of\b|$)/, '')
    .replace(/\bCommunity\b/, 'Comm.')
    .replace(/\bPreparatory\b/, 'Prep')
    .replace(/\bInternational\b/, 'Intl.')
    .replace(/\s+of\s+.*$/, '')
  return keepIfEmpty(name, short)
}

/**
 * A synagogue's chart name: drop a leading Congregation, Temple or Kehillat,
 * then drop a trailing "of ..." qualifier.
 */
export function synagogueChartName(name: string): string {
  const short = name.replace(/^(Congregation|Temple|Kehillat)\s+/i, '').replace(/\s+of\s+.*$/, '')
  return keepIfEmpty(name, short)
}

/** A shortening that leaves nothing, or only a bare "of ..." qualifier, keeps the full name. */
function keepIfEmpty(name: string, short: string): string {
  const s = short.trim()
  return s === '' || /^of\b/i.test(s) ? name : s
}

/**
 * The axis labels for one chart's names, in order. Each name is shortened,
 * except that names whose labels would read the same keep their full names: the
 * mock's own readout flagged two congregations collapsing into one label, and
 * two bars that read the same are worse than one cut-off label. Repeats until no
 * label is shared, since a kept full name can match another name's short form.
 */
export function chartAxisLabels(names: string[], shorten: (name: string) => string): string[] {
  const labels = names.map(shorten)
  let changed = true
  while (changed) {
    const owners = new Map<string, Set<string>>()
    labels.forEach((label, i) => {
      owners.set(label, (owners.get(label) ?? new Set<string>()).add(names[i] ?? label))
    })
    changed = false
    labels.forEach((label, i) => {
      const full = names[i] ?? label
      if ((owners.get(label)?.size ?? 0) > 1 && label !== full) {
        labels[i] = full
        changed = true
      }
    })
  }
  return labels
}
