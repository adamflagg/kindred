import { useState } from 'react'
import type { RecordModel } from 'pocketbase'
import { pb } from '../../../lib/pocketbase'

const AVATAR_COLORS = [
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
]

/** A consistent avatar background from a string. */
function getAvatarColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash = hash & hash
  }
  return (
    AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length] ??
    'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
  )
}

/**
 * The person's photo (PocketBase thumb), or a coloured initial. Shared by the
 * table and the drawers. A photo that fails to load (a 404 for a file that is
 * gone) falls back to the initial rather than a broken-image glyph.
 */
export function UserAvatar({ user, size = 28 }: { user: RecordModel; size?: number }) {
  const email = String(user['email'] ?? '')
  const rawName = String(user['name'] ?? '')
  const name = rawName === '' ? (email.split('@')[0] ?? '') : rawName
  const file = String(user['avatar'] ?? '')
  const src = file ? pb.files.getURL(user, file, { thumb: '56x56' }) : ''
  // Keyed by URL: a new photo gets its own chance to load.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const avatar = src !== '' && src !== failedSrc
  return (
    <span
      data-testid="user-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={`flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${
        avatar ? '' : getAvatarColor(email)
      }`}
    >
      {avatar ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        (name === '' ? email : name).charAt(0).toUpperCase()
      )}
    </span>
  )
}
