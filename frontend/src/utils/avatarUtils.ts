/**
 * Shared avatar utilities for camper display components
 */

/**
 * Get avatar background color based on gender
 */
export function getAvatarColor(gender: string | undefined): string {
  switch (gender) {
    case 'M':
      return 'bg-sky-500'
    case 'F':
      return 'bg-pink-500'
    default:
      return 'bg-purple-500'
  }
}

/**
 * Get initial letter from first name for avatar display
 */
export function getInitial(firstName: string | undefined): string {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional || to handle empty string
  return firstName?.charAt(0).toUpperCase() || '?'
}
