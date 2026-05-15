interface CamperNameButtonProps {
  cmId: number
  name: string
  onSelect: (id: string) => void
}

export function CamperNameButton({ cmId, name, onSelect }: CamperNameButtonProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(String(cmId))}
      className="text-left underline-offset-2 hover:underline focus:underline focus:outline-none"
    >
      {name}
    </button>
  )
}
