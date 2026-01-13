import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Clock, CheckCircle, XCircle, Loader2, Info } from 'lucide-react';
import { type SyncStatus } from '../../hooks/useSyncStatusAPI';
import {
  type ScaleType,
  SCALE_DEFINITIONS,
  getImpactLevel,
} from '../../utils/scaleContext';

// ============ INPUT COMPONENTS ============

export interface ToggleSwitchProps {
  value: boolean | string | number;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ToggleSwitch({ value, onChange, disabled = false }: ToggleSwitchProps) {
  const isChecked = value === true || value === '1' || value === 'true' || value === 1;

  return (
    <button
      onClick={() => !disabled && onChange(isChecked ? '0' : '1')}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-forest-500 focus:ring-offset-2 dark:focus:ring-offset-card ${
        isChecked ? 'bg-forest-600 dark:bg-forest-500' : 'bg-stone-300 dark:bg-stone-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      role="switch"
      aria-checked={isChecked}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          isChecked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export interface SliderProps {
  value: string | number;
  onChange: (value: string) => void;
  config?: { min?: number; max?: number; step?: number; suffix?: string; precision?: number };
}

export function Slider({ value, onChange, config = {} }: SliderProps) {
  const { min = 0, max = 100, step = 1, suffix = '', precision = 0 } = config;
  const numValue = typeof value === 'string' ? parseFloat(value) || min : value;

  // Use local state during dragging for smooth interaction
  const [localValue, setLocalValue] = useState<number | null>(null);
  const displayValue = localValue ?? numValue;

  return (
    <div className="flex items-center gap-3 w-36 sm:w-48">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={(e) => setLocalValue(parseFloat(e.target.value))}
        onMouseUp={() => {
          if (localValue !== null) {
            onChange(String(localValue));
            setLocalValue(null);
          }
        }}
        onTouchEnd={() => {
          if (localValue !== null) {
            onChange(String(localValue));
            setLocalValue(null);
          }
        }}
        className="flex-1 h-2 bg-stone-200 dark:bg-stone-700 rounded-full appearance-none cursor-pointer accent-forest-600 dark:accent-forest-400"
      />
      <span className="w-14 sm:w-16 text-right font-mono text-xs sm:text-sm text-muted-foreground tabular-nums">
        {precision > 0 ? displayValue.toFixed(precision) : displayValue}{suffix}
      </span>
    </div>
  );
}

export interface NumberInputProps {
  value: string | number;
  onChange: (value: string) => void;
  config?: { min?: number; max?: number; step?: number; suffix?: string };
}

export function NumberInput({ value, onChange, config = {} }: NumberInputProps) {
  const { min, max, step = 1, suffix = '' } = config;

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 px-2 py-1.5 text-sm border border-border rounded-lg text-center font-mono bg-background text-foreground focus:border-forest-500 focus:ring-1 focus:ring-forest-500 focus:outline-none"
      />
      {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
    </div>
  );
}

export interface SelectInputProps {
  value: string;
  onChange: (value: string) => void;
  config?: { placeholder?: string; options?: Array<{ value: string; label: string }> };
}

export function SelectInput({ value, onChange, config = {} }: SelectInputProps) {
  const { placeholder = 'Select...', options = [] } = config;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:border-forest-500 focus:ring-1 focus:ring-forest-500 focus:outline-none"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  config?: { placeholder?: string };
}

export function TextInput({ value, onChange, config = {} }: TextInputProps) {
  const { placeholder = '' } = config;

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-24 px-3 py-1.5 text-sm border border-border rounded-lg bg-background text-foreground focus:border-forest-500 focus:ring-1 focus:ring-forest-500 focus:outline-none font-mono"
    />
  );
}

// ============ COMPONENT MAP & INFERENCE ============

/**
 * Infer component type from value when metadata is missing
 */
// eslint-disable-next-line react-refresh/only-export-components -- Utility function for config type inference
export function inferComponentType(value: unknown, configKey: string): string {
  const strValue = String(value);

  // Boolean-like values
  if (strValue === 'true' || strValue === 'false' || strValue === '0' || strValue === '1') {
    if (configKey.includes('enabled') || configKey.includes('enable') ||
        configKey.includes('prevent') || configKey.includes('prefer') ||
        configKey.includes('require') || configKey.includes('ignore') ||
        configKey.includes('use_') || configKey.includes('include') ||
        configKey.includes('flag') || configKey.includes('auto_')) {
      return 'toggle';
    }
  }

  // Numeric values - use number input for precision
  const numValue = parseFloat(strValue);
  if (!isNaN(numValue)) {
    return 'number';
  }

  return 'text';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, react-refresh/only-export-components -- Config constant for component registry
export const COMPONENT_MAP: Record<string, React.FC<any>> = {
  toggle: ToggleSwitch,
  slider: Slider,
  number: NumberInput,
  select: SelectInput,
  text: TextInput,
};

// ============ STATUS & UTILITY COMPONENTS ============

export function StatusIcon({ status }: { status: SyncStatus['status'] | 'pending' }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-4 h-4 text-sky-600 animate-spin" />;
    case 'pending':
      return <Clock className="w-4 h-4 text-amber-600" />;
    case 'success':
      return <CheckCircle className="w-4 h-4 text-emerald-600" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-600" />;
    default:
      return <div className="w-4 h-4 rounded-full bg-stone-200" />;
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- Utility function for duration formatting
export function formatDuration(seconds?: number): string {
  if (seconds === null || seconds === undefined) return '';
  if (seconds === 0) return '< 1s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// ============ SCALE CONTEXT UI COMPONENTS ============

export interface ImpactBadgeProps {
  scaleType: ScaleType;
  value: number;
  metadata?: Record<string, unknown>;
}

export function ImpactBadge({ scaleType, value, metadata }: ImpactBadgeProps) {
  const level = getImpactLevel(scaleType, value, metadata);
  if (!level) return null;

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold tracking-wide uppercase ${level.color} ${level.bgColor}`}>
      {level.label}
    </span>
  );
}

export interface ScaleContextBarProps {
  scaleType: ScaleType;
  value: number;
  metadata?: Record<string, unknown>;
}

export function ScaleContextBar({ scaleType, value, metadata }: ScaleContextBarProps) {
  const scale = SCALE_DEFINITIONS[scaleType];
  if (!scale || scaleType === 'unknown') return null;

  const minValue = (metadata?.['min_value'] as number) ?? scale.min;
  const maxValue = (metadata?.['max_value'] as number) ?? scale.max;

  const normalizedValue = (value - minValue) / (maxValue - minValue);
  const position = Math.max(0, Math.min(100, normalizedValue * 100));

  return (
    <div className="w-full h-1.5 bg-stone-200 dark:bg-stone-700 rounded-full overflow-hidden relative mt-1">
      <div className="absolute inset-0 bg-gradient-to-r from-sky-300 via-amber-300 to-red-400 dark:from-sky-600 dark:via-amber-500 dark:to-red-500 opacity-30" />
      <div
        className="absolute top-0 h-full w-1 bg-forest-600 dark:bg-forest-400 rounded-full shadow-sm transform -translate-x-1/2 transition-all duration-300"
        style={{ left: `${position}%` }}
      />
    </div>
  );
}

// ============ TOOLTIP COMPONENTS ============

export interface PortalTooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  className?: string;
}

export function PortalTooltip({ children, content, className = "w-64" }: PortalTooltipProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const tooltipWidth = className.includes('w-72') ? 288 : 256;
      const tooltipHeight = 100;
      const padding = 8;

      let top = rect.top - tooltipHeight - padding;
      let left = rect.left + rect.width / 2 - tooltipWidth / 2;

      if (top < padding) {
        top = rect.bottom + padding;
      }

      if (left < padding) left = padding;
      if (left + tooltipWidth > window.innerWidth - padding) {
        left = window.innerWidth - tooltipWidth - padding;
      }

      setPosition({ top, left });
    }
  }, [className]);

  useEffect(() => {
    if (isVisible) {
      updatePosition();
      window.addEventListener('scroll', updatePosition, true);
      window.addEventListener('resize', updatePosition);
      return () => {
        window.removeEventListener('scroll', updatePosition, true);
        window.removeEventListener('resize', updatePosition);
      };
    }
  }, [isVisible, updatePosition]);

  const tooltipContent = (
    <div
      className={`fixed z-[9999] ${className} pointer-events-none transition-opacity duration-150`}
      style={{
        top: position.top,
        left: position.left,
        opacity: isVisible ? 1 : 0,
        visibility: isVisible ? 'visible' : 'hidden',
      }}
    >
      {content}
    </div>
  );

  return (
    <div className="relative inline-flex">
      <div
        ref={triggerRef}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children}
      </div>
      {createPortal(tooltipContent, document.body)}
    </div>
  );
}

export interface ScaleTooltipProps {
  scaleType: ScaleType;
  value: number;
  metadata?: Record<string, unknown>;
}

export function ScaleTooltip({ scaleType, value, metadata }: ScaleTooltipProps) {
  const scale = SCALE_DEFINITIONS[scaleType];
  const triggerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const tooltipWidth = 288;
      const tooltipHeight = 120;
      const padding = 8;

      let top = rect.top - tooltipHeight - padding;
      let left = rect.left + rect.width / 2 - tooltipWidth / 2;

      if (top < padding) {
        top = rect.bottom + padding;
      }

      if (left < padding) left = padding;
      if (left + tooltipWidth > window.innerWidth - padding) {
        left = window.innerWidth - tooltipWidth - padding;
      }

      setPosition({ top, left });
    }
  }, []);

  useEffect(() => {
    if (!scale || scaleType === 'unknown' || !isVisible) return;

    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isVisible, scale, scaleType, updatePosition]);

  if (!scale || scaleType === 'unknown') return null;

  const minValue = (metadata?.['min_value'] as number) ?? scale.min;
  const maxValue = (metadata?.['max_value'] as number) ?? scale.max;
  const impactText = scale.impactExplainer(value, minValue, maxValue);

  const tooltipContent = (
    <div
      className="fixed z-[9999] w-80 pointer-events-none transition-opacity duration-150"
      style={{
        top: position.top,
        left: position.left,
        opacity: isVisible ? 1 : 0,
        visibility: isVisible ? 'visible' : 'hidden',
      }}
    >
      <div className="bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm rounded-lg p-4 shadow-xl border border-stone-700 dark:border-stone-300">
        <div className="font-semibold mb-2 text-amber-300 dark:text-amber-600 text-base">
          {scale.type.charAt(0).toUpperCase() + scale.type.slice(1)} Scale
        </div>
        <p className="text-stone-300 dark:text-stone-600 text-sm mb-3 leading-relaxed">
          {scale.description}
        </p>
        <div className="pt-3 border-t border-stone-700 dark:border-stone-300">
          <p className="text-white dark:text-stone-900 text-sm leading-relaxed">
            {impactText}
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative inline-flex ml-1.5">
      <div
        ref={triggerRef}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        className="w-5 h-5 rounded-full bg-stone-100 dark:bg-stone-800 flex items-center justify-center cursor-help border border-stone-200 dark:border-stone-700 hover:border-forest-400 transition-colors"
      >
        <span className="text-xs font-bold text-stone-500 dark:text-stone-400">?</span>
      </div>
      {createPortal(tooltipContent, document.body)}
    </div>
  );
}

// Re-export Info icon for tooltip trigger usage
export { Info };
