/**
 * The rules' program keys, in words. The keys come from the season's rules data (a rules program
 * names itself), so this names the known ones and spells out any other: underscores become
 * spaces, first letter capital. Pool names are not here: they come from the Remaining read.
 */
const PROGRAM_LABELS: Readonly<Record<string, string>> = {
  summer: 'Summer camp',
  family_camp: 'Family Camp',
  tbm: 'TBM',
  womens_weekend: "Women's Weekend",
  mens_weekend: "Men's Weekend",
}

export function programLabel(key: string): string {
  const known = PROGRAM_LABELS[key]
  if (known !== undefined) return known
  const spaced = key.replaceAll('_', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
