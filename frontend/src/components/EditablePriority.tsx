import { useState, useRef, useEffect, memo } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

interface EditablePriorityProps {
  value: number;
  onChange: (newPriority: number) => void;
  disabled?: boolean;
}

const priorities = [4, 3, 2, 1];

// Visual styling for each priority level
const priorityStyles = {
  4: { color: 'text-red-600 dark:text-red-400', label: 'Critical' },
  3: { color: 'text-amber-600 dark:text-amber-400', label: 'Important' },
  2: { color: 'text-forest-600 dark:text-forest-400', label: 'Standard' },
  1: { color: 'text-stone-500 dark:text-stone-400', label: 'Low' },
} as const;

const defaultStyle = priorityStyles[2];

function getStyle(priority: number) {
  return priorityStyles[priority as keyof typeof priorityStyles] ?? defaultStyle;
}

// Memoized component - only re-renders when value or disabled changes
// Uses custom comparison to ignore onChange callback reference changes
const EditablePriority = memo(function EditablePriority({ value, onChange, disabled }: EditablePriorityProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleSelect = (newPriority: number) => {
    if (newPriority !== value) {
      onChange(newPriority);
    }
    setIsOpen(false);
  };

  const style = getStyle(value);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={clsx(
          "inline-flex items-center gap-1.5 px-2 py-1 text-sm rounded transition-colors",
          "hover:bg-muted border border-transparent hover:border-border",
          "min-w-[44px] justify-center",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        disabled={disabled}
        title={style.label}
      >
        {/* Priority dots indicator */}
        <span className={clsx("flex gap-0.5", style.color)}>
          {[1, 2, 3, 4].map((dot) => (
            <span
              key={dot}
              className={clsx(
                "w-1.5 h-1.5 rounded-full",
                dot <= value ? "bg-current" : "bg-current opacity-20"
              )}
            />
          ))}
        </span>
        <ChevronDown className="w-3 h-3 text-muted-foreground" />
      </button>

      {isOpen && (
        <div className="absolute z-[60] mt-1 w-28 bg-popover border border-border rounded-md shadow-lg">
          <div className="py-1">
            {priorities.map((priority) => {
              const pStyle = getStyle(priority);
              return (
                <button
                  key={priority}
                  onClick={() => handleSelect(priority)}
                  className={clsx(
                    "w-full px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-muted transition-colors",
                    value === priority && "bg-muted font-medium"
                  )}
                >
                  <span className={clsx("flex gap-0.5", pStyle.color)}>
                    {[1, 2, 3, 4].map((dot) => (
                      <span
                        key={dot}
                        className={clsx(
                          "w-1.5 h-1.5 rounded-full",
                          dot <= priority ? "bg-current" : "bg-current opacity-20"
                        )}
                      />
                    ))}
                  </span>
                  <span className={clsx("text-xs", pStyle.color)}>{pStyle.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if value or disabled changes
  // Ignores onChange reference changes for better performance
  return prevProps.value === nextProps.value && prevProps.disabled === nextProps.disabled;
});

export default EditablePriority;