interface FirstPickBadgeProps {
  isFirstRequested: boolean
}

export default function FirstPickBadge({ isFirstRequested }: FirstPickBadgeProps) {
  if (!isFirstRequested) return null
  return (
    <span className="text-xs leading-none" title="First pick" aria-label="First pick" role="img">
      ❗
    </span>
  )
}
