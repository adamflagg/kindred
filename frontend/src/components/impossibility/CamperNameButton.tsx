interface CamperNameButtonProps {
  cmId: number
  name: string
  /** Receives the stringified CampMinder ID — matches CamperDetailsPanel.camperId. */
  onSelect: (id: string) => void
  /** Render a plain span instead of an interactive button (e.g. when the surrounding context can't open the details panel). */
  disabled?: boolean
}

export function CamperNameButton({
  cmId,
  name,
  onSelect,
  disabled = false,
}: CamperNameButtonProps) {
  if (disabled) {
    return <span className="text-foreground">{name}</span>
  }
  return (
    <button
      type="button"
      onClick={() => onSelect(String(cmId))}
      aria-label={`Open details for ${name}`}
      className="text-left underline decoration-stone-400 decoration-dotted underline-offset-2 hover:decoration-stone-700 focus:decoration-stone-700 focus:outline-none"
    >
      {name}
    </button>
  )
}
