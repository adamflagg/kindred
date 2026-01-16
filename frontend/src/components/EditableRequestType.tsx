import { useState, useRef, useEffect, memo } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

interface EditableRequestTypeProps {
  value: string;
  onChange: (newType: string) => void;
  disabled?: boolean;
}

const requestTypes = [
  { value: 'bunk_with', label: 'Bunk With' },
  { value: 'not_bunk_with', label: 'Not Bunk With' },
  { value: 'age_preference', label: 'Age Preference' }
];

// Memoized component - only re-renders when value or disabled changes
const EditableRequestType = memo(function EditableRequestType({ value, onChange, disabled }: EditableRequestTypeProps) {
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

  const currentType = requestTypes.find(t => t.value === value);
  const label = currentType?.label || value;

  const handleSelect = (newType: string) => {
    if (newType !== value) {
      onChange(newType);
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
          "w-full max-w-full justify-between",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        disabled={disabled}
      >
        <span className="whitespace-nowrap">{label}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {isOpen && (
        <div className="absolute z-[60] mt-1 w-48 bg-popover border border-border rounded-md shadow-lg">
          <div className="py-1">
            {requestTypes.map((type) => (
              <button
                key={type.value}
                onClick={() => handleSelect(type.value)}
                className={clsx(
                  "w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors",
                  value === type.value && "bg-muted font-medium"
                )}
              >
                <span className="whitespace-nowrap">{type.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if value or disabled changes
  return prevProps.value === nextProps.value && prevProps.disabled === nextProps.disabled;
});

export default EditableRequestType;