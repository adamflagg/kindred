import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

interface EditablePriorityProps {
  value: number;
  onChange: (newPriority: number) => void;
  disabled?: boolean;
}

const priorities = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

export default function EditablePriority({ value, onChange, disabled }: EditablePriorityProps) {
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

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={clsx(
          "inline-flex items-center gap-1 px-2 py-1 text-sm rounded transition-colors",
          "hover:bg-muted border border-transparent hover:border-border",
          "min-w-[60px] justify-center",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        disabled={disabled}
      >
        <span className="font-medium">{value}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {isOpen && (
        <div className="absolute z-[60] mt-1 w-20 bg-popover border border-border rounded-md shadow-lg">
          <div className="py-1 max-h-[200px] overflow-y-auto">
            {priorities.map((priority) => (
              <button
                key={priority}
                onClick={() => handleSelect(priority)}
                className={clsx(
                  "w-full px-3 py-1.5 text-sm text-center hover:bg-muted transition-colors",
                  value === priority && "bg-muted font-medium"
                )}
              >
                {priority}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}