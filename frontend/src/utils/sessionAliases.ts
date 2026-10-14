/**
 * Manual session name aliases for YoY comparison.
 *
 * When CampMinder creates new sessions (new cm_ids) that replace
 * old ones, matchKey="id" can't bridge them. This map lets the
 * merge logic treat renamed sessions as the same row.
 *
 * Keys: alternate session names → Values: the alias group's key
 *
 * A group is an equivalence class: every name in it is the same session, in either direction
 * across years. The value is just the group's key, not necessarily the current year's name
 * (2027 returns to "Taste of Camp", keyed "Taste of Camp 1").
 */
export const SESSION_NAME_ALIASES: Record<string, string> = {
  'Taste of Camp': 'Taste of Camp 1',
  'Session 2b': 'Taste of Camp 2',
}

/**
 * Resolve a session name to its alias group's key.
 * Returns the key if the name is in a group, otherwise the original name.
 */
export function resolveSessionAlias(name: string): string {
  return SESSION_NAME_ALIASES[name] ?? name
}

/**
 * Every name (canonical first, then old names) that refers to the same session.
 * Mirrors `get_alias_group` in api/utils/session_aliases.py; the alias map is
 * held equal to the server's by tests/unit/api/test_session_aliases_parity.py.
 */
export function getAliasGroup(name: string): string[] {
  const canonical = resolveSessionAlias(name)
  const alternates = Object.entries(SESSION_NAME_ALIASES)
    .filter(([, c]) => c === canonical)
    .map(([old]) => old)
  return [canonical, ...alternates]
}
