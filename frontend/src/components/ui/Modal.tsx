import { X } from 'lucide-react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  header?: ReactNode // Custom header content (overrides title)
  footer?: ReactNode // Footer content
  children: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  noPadding?: boolean // Remove default padding for complex layouts
  scrollable?: boolean // Make content area scrollable
  // Accessibility: callers using the custom `header` slot should thread
  // either an id referencing the heading element, or a literal label, so
  // screen readers have a name for the dialog.
  ariaLabelledBy?: string
  ariaLabel?: string
  // CSS length (e.g. "28rem") that insets BOTH the blurred backdrop and the
  // modal-centering wrapper from the viewport's right edge. Used when the
  // modal opens on top of a right-side slide-out panel — the panel area
  // stays unblurred and the modal centers in the remaining space.
  backdropInsetRight?: string
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
} as const

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
  ariaLabelledBy,
  ariaLabel,
  backdropInsetRight,
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  // Determine if we're using custom header or simple title mode
  const hasCustomHeader = header !== undefined
  const hasSimpleTitle = !hasCustomHeader && title !== undefined

  const resolvedLabelledBy = ariaLabelledBy ?? (hasSimpleTitle ? 'modal-title' : undefined)

  // Portal to document.body so the modal escapes any parent stacking context
  // (e.g. z-[60] CamperDetailsPanel). z-[100] keeps us above documented panels.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={resolvedLabelledBy}
      aria-label={!resolvedLabelledBy ? ariaLabel : undefined}
      style={backdropInsetRight ? { right: backdropInsetRight } : undefined}
    >
      {/* Backdrop — fills the (already-inset) dialog wrapper via inset-0,
          so the wrapper's right offset is the single source of truth. */}
      <div
        data-testid="modal-backdrop"
        className="absolute inset-0 backdrop-blur"
        style={{ backgroundColor: 'rgba(17, 26, 22, 0.42)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        data-testid="modal-content"
        className={`bg-card border-border relative overflow-hidden rounded-2xl border ${noPadding ? '' : 'p-6'} ${sizeClasses[size]} mx-4 w-full`}
        style={{
          boxShadow:
            '0 24px 60px -24px rgba(7, 20, 14, 0.35), 0 8px 24px -12px rgba(7, 20, 14, 0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Custom header mode - header spans full width, close button floats on top */}
        {hasCustomHeader && (
          <div className="relative">
            {header}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground absolute top-4 right-4 rounded-lg p-2 transition-colors hover:bg-black/10"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Simple title mode */}
        {hasSimpleTitle && (
          <div className="mb-4 flex items-center justify-between">
            <h2 id="modal-title" className="text-xl font-bold">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg p-2 transition-colors"
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
              className="hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg p-2 transition-colors"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Content area - optionally scrollable */}
        {scrollable ? (
          <div data-testid="modal-body" className="max-h-[calc(90vh-200px)] overflow-y-auto">
            {children}
          </div>
        ) : (
          children
        )}

        {/* Footer */}
        {footer && <div data-testid="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export default Modal
