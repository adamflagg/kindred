import { X } from 'lucide-react';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  header?: ReactNode;  // Custom header content (overrides title)
  footer?: ReactNode;  // Footer content
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  noPadding?: boolean;  // Remove default padding for complex layouts
  scrollable?: boolean;  // Make content area scrollable
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

/**
 * Shared modal component for consistent modal styling across the app.
 *
 * Usage (simple):
 * ```tsx
 * <Modal isOpen={isOpen} onClose={handleClose} title="My Modal" size="md">
 *   <p>Modal content goes here</p>
 * </Modal>
 * ```
 *
 * Usage (with slots):
 * ```tsx
 * <Modal
 *   isOpen={isOpen}
 *   onClose={handleClose}
 *   header={<div className="flex items-center">Custom Header</div>}
 *   footer={<div className="flex gap-2"><button>Cancel</button><button>Save</button></div>}
 *   noPadding
 *   scrollable
 * >
 *   <div className="p-6">Scrollable content</div>
 * </Modal>
 * ```
 */
export function Modal({
  isOpen,
  onClose,
  title,
  header,
  footer,
  children,
  size = 'md',
  noPadding = false,
  scrollable = false,
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Determine if we're using custom header or simple title mode
  const hasCustomHeader = header !== undefined;
  const hasSimpleTitle = !hasCustomHeader && title !== undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={hasSimpleTitle ? 'modal-title' : undefined}
    >
      {/* Backdrop */}
      <div
        data-testid="modal-backdrop"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        data-testid="modal-content"
        className={`relative bg-card rounded-xl shadow-xl border border-border overflow-hidden ${noPadding ? '' : 'p-6'} ${sizeClasses[size]} w-full mx-4`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Custom header mode - header spans full width, close button floats on top */}
        {hasCustomHeader && (
          <div className="relative">
            {header}
            <button
              onClick={onClose}
              className="absolute top-1/2 right-3 -translate-y-1/2 p-2 hover:bg-black/10 rounded-lg transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Simple title mode */}
        {hasSimpleTitle && (
          <div className="flex items-center justify-between mb-4">
            <h2 id="modal-title" className="text-xl font-bold">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* No title/header mode - floating close button */}
        {!hasCustomHeader && !hasSimpleTitle && (
          <div className="absolute top-4 right-4">
            <button
              onClick={onClose}
              className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Content area - optionally scrollable */}
        {scrollable ? (
          <div data-testid="modal-body" className="overflow-y-auto max-h-[calc(90vh-200px)]">
            {children}
          </div>
        ) : (
          children
        )}

        {/* Footer */}
        {footer && (
          <div data-testid="modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
