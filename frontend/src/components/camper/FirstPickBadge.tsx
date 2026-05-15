interface FirstPickBadgeProps {
  isFirstRequested: boolean
}

export default function FirstPickBadge({ isFirstRequested }: FirstPickBadgeProps) {
  if (!isFirstRequested) return null
  return (
    <span
      className="rounded bg-green-100 px-1.5 text-[10px] leading-4 font-bold text-green-800 dark:bg-green-900/40 dark:text-green-300"
      title="First pick"
      aria-label="First pick"
    >
      1
    </span>
  )
}
