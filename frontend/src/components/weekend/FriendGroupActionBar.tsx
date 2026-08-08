/**
 * The bottom action bar for authoring a weekend friend group.
 *
 * Ported wholesale from summer's `LockGroupActionBar.tsx` — the fixed bar, the
 * live selection count, the "(select at least 2)" nudge, the optional name
 * input whose PLACEHOLDER is the auto-name, the inline colour palette and the
 * Clear / Create pair. Forked rather than shared: summer's bar creates
 * `locked_groups` rows over campers and this one creates
 * `lodging_friend_groups` rows over households, so a shared component would be
 * a grain-generic prop soup. The scenario modal is the in-repo precedent.
 *
 * ## What summer does not have: the intent choice
 *
 * NEAR and WITH are different requests — NEAR is satisfied by distance between
 * units, WITH only by putting both parties in one room — so a weekend group
 * that cannot say which one it means is the wrong object (kindred#1913). It is
 * a two-radio group rather than a checkbox, because the two are alternatives
 * and the control has to make that visible before the group is created.
 *
 * ## What summer has that this deliberately does not
 *
 * The cross-session and cross-gender validation, and the conflict dialog for a
 * camper already in another group. Neither transfers. Every household in the
 * picker is on THIS weekend's roster by construction, weekends do not split by
 * gender, and a household may legitimately want the same cabin as one family
 * and to be near a different one — which is two groups, not a conflict. See
 * migration 1500000144's header for why the schema permits it.
 */
import { Heart, Users } from 'lucide-react'
import clsx from 'clsx'

import type { FriendGroupIntent } from '../../types/friendGroups'
import type { RosterPartyRow } from '../../types/lodging'
import {
  defaultFriendGroupName,
  FRIEND_GROUP_COLOR_NAMES,
  FRIEND_GROUP_COLORS,
  FRIEND_GROUP_INTENT_HELP,
  FRIEND_GROUP_INTENT_LABEL,
} from './friendGroups'

export interface FriendGroupActionBarProps {
  /** The households picked so far, in the order they were picked. */
  selected: RosterPartyRow[]
  name: string
  onNameChange: (name: string) => void
  color: string
  onColorChange: (color: string) => void
  intent: FriendGroupIntent
  onIntentChange: (intent: FriendGroupIntent) => void
  onClear: () => void
  onCreate: () => void
  isPending: boolean
}

/** A colour swatch as a real radio, so the palette is reachable without sight. */
function ColorSwatch({
  color,
  checked,
  onChange,
  groupName,
}: {
  color: string
  checked: boolean
  onChange: (color: string) => void
  groupName: string
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="radio"
        name={groupName}
        value={color}
        checked={checked}
        onChange={() => {
          onChange(color)
        }}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={clsx(
          'block h-6 w-6 rounded-full transition-all',
          checked && 'ring-foreground scale-110 ring-2 ring-offset-2'
        )}
        style={{ backgroundColor: color }}
      />
      <span className="sr-only">{FRIEND_GROUP_COLOR_NAMES[color] ?? color}</span>
    </label>
  )
}

export function FriendGroupActionBar({
  selected,
  name,
  onNameChange,
  color,
  onColorChange,
  intent,
  onIntentChange,
  onClear,
  onCreate,
  isPending,
}: FriendGroupActionBarProps) {
  // Nothing selected is nothing to do — the bar is absent rather than empty,
  // exactly as summer's returns null on an empty pending list.
  if (selected.length === 0) return null

  // Computed at render, never stored: a stored auto-name goes stale the moment
  // the selection changes. Shown as the PLACEHOLDER so a blank field means
  // "use it" and a typed one wins.
  const autoName = defaultFriendGroupName(selected)
  const canCreate = selected.length >= 2 && !isPending

  return (
    <div
      data-testid="friend-group-action-bar"
      className="bg-background shadow-lodge-lg fixed right-0 bottom-0 left-0 z-40 border-t"
    >
      <div className="container mx-auto px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Users className="text-primary h-5 w-5" aria-hidden="true" />
              <span className="font-medium">
                {selected.length} household{selected.length === 1 ? '' : 's'} selected
              </span>
            </div>
            {selected.length < 2 && (
              <span className="text-muted-foreground text-sm">(select at least 2)</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              aria-label="Group name"
              value={name}
              onChange={(event) => {
                onNameChange(event.target.value)
              }}
              placeholder={autoName || 'Group name'}
              className="bg-background focus:ring-primary/50 w-44 rounded-lg border px-3 py-1.5 text-sm focus:ring-2 focus:outline-none"
            />

            <div className="bg-border h-6 w-px" aria-hidden="true" />

            {/* The one control summer has no equivalent for. `fieldset` so the
                pair announces as a group rather than as two loose radios. */}
            <fieldset className="flex items-center gap-2">
              <legend className="sr-only">What this group needs</legend>
              {(['with', 'near'] as const).map((candidate) => (
                <label
                  key={candidate}
                  title={FRIEND_GROUP_INTENT_HELP[candidate]}
                  className={clsx(
                    'cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors',
                    intent === candidate
                      ? 'border-primary bg-primary/10 text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  <input
                    type="radio"
                    name="friend-group-intent"
                    value={candidate}
                    checked={intent === candidate}
                    onChange={() => {
                      onIntentChange(candidate)
                    }}
                    className="sr-only"
                  />
                  {FRIEND_GROUP_INTENT_LABEL[candidate]}
                </label>
              ))}
            </fieldset>

            <div className="bg-border h-6 w-px" aria-hidden="true" />

            <fieldset className="flex items-center gap-1.5">
              <legend className="sr-only">Group colour</legend>
              {FRIEND_GROUP_COLORS.map((candidate) => (
                <ColorSwatch
                  key={candidate}
                  color={candidate}
                  checked={color === candidate}
                  onChange={onColorChange}
                  groupName="friend-group-color"
                />
              ))}
            </fieldset>

            <div className="bg-border h-6 w-px" aria-hidden="true" />

            <button
              type="button"
              onClick={onClear}
              className="hover:bg-muted rounded-lg border px-3 py-1.5 text-sm transition-colors"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onCreate}
              disabled={!canCreate}
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Heart className="h-4 w-4" aria-hidden="true" />
              {isPending ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
