/**
 * CampMinder logo icon - lowercase "cm"
 * Uses Open Sans (official CampMinder brand font)
 */
export function CampMinderIcon({ className = "w-6 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 28 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="CampMinder"
    >
      <text
        x="14"
        y="15.5"
        textAnchor="middle"
        fontSize="16"
        fontWeight="800"
        fontFamily="'Open Sans', sans-serif"
      >
        cm
      </text>
    </svg>
  );
}

export default CampMinderIcon;
