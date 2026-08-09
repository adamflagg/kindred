import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  describe('when isOpen is false', () => {
    it('renders nothing', () => {
      const { container } = render(
        <Modal isOpen={false} onClose={() => {}}>
          <p>Modal content</p>
        </Modal>
      )

      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('when isOpen is true', () => {
    it('renders the modal content', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.getByText('Modal content')).toBeInTheDocument()
    })

    it('renders the title when provided', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Test Title">
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.getByText('Test Title')).toBeInTheDocument()
    })

    it('does not render title when not provided', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    })

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose}>
          <p>Modal content</p>
        </Modal>
      )

      const closeButton = screen.getByRole('button', { name: /close/i })
      fireEvent.click(closeButton)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose}>
          <p>Modal content</p>
        </Modal>
      )

      const backdrop = screen.getByTestId('modal-backdrop')
      fireEvent.click(backdrop)

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not close when modal content is clicked', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose}>
          <p>Modal content</p>
        </Modal>
      )

      // Click on the modal content, not the backdrop
      const content = screen.getByText('Modal content')
      fireEvent.click(content)

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('size variants', () => {
    it.each([
      ['sm', 'max-w-md'],
      ['lg', 'max-w-2xl'],
      ['xl', 'max-w-4xl'],
    ] as const)('applies %s size class', (size, expectedClass) => {
      render(
        <Modal isOpen={true} onClose={() => {}} size={size}>
          <p>Content</p>
        </Modal>
      )
      const modalContent = screen.getByTestId('modal-content')
      expect(modalContent).toHaveClass(expectedClass)
    })

    it('applies md size class (default)', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      )
      const modalContent = screen.getByTestId('modal-content')
      expect(modalContent).toHaveClass('max-w-lg')
    })
  })

  describe('accessibility', () => {
    it('has appropriate role for dialog', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Accessible Modal">
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('close button is accessible', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Modal content</p>
        </Modal>
      )

      const closeButton = screen.getByRole('button', { name: /close/i })
      expect(closeButton).toBeInTheDocument()
    })

    it('calls onClose when Escape key is pressed', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose}>
          <p>Modal content</p>
        </Modal>
      )

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('does not call onClose for other keys', () => {
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose}>
          <p>Modal content</p>
        </Modal>
      )

      fireEvent.keyDown(document, { key: 'Enter' })
      fireEvent.keyDown(document, { key: 'Tab' })
      fireEvent.keyDown(document, { key: 'a' })

      expect(onClose).not.toHaveBeenCalled()
    })

    it('removes event listener when modal closes', () => {
      const onClose = vi.fn()
      const { rerender } = render(
        <Modal isOpen={true} onClose={onClose}>
          <p>Modal content</p>
        </Modal>
      )

      // Close the modal
      rerender(
        <Modal isOpen={false} onClose={onClose}>
          <p>Modal content</p>
        </Modal>
      )

      // Escape key should not trigger onClose after modal is closed
      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('custom header slot', () => {
    it('renders custom header instead of title', () => {
      render(
        <Modal
          isOpen={true}
          onClose={() => {}}
          header={<div data-testid="custom-header">Custom Header</div>}
        >
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.getByTestId('custom-header')).toBeInTheDocument()
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    })

    it('header overrides title when both provided', () => {
      render(
        <Modal
          isOpen={true}
          onClose={() => {}}
          title="Should Not Appear"
          header={<div>Custom Header Only</div>}
        >
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.getByText('Custom Header Only')).toBeInTheDocument()
      expect(screen.queryByText('Should Not Appear')).not.toBeInTheDocument()
    })

    it('still shows close button with custom header', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} header={<div>Custom Header</div>}>
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    })
  })

  describe('footer slot', () => {
    it('renders footer content', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} footer={<button>Save</button>}>
          <p>Modal content</p>
        </Modal>
      )

      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })

    it('renders footer after content', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} footer={<div data-testid="footer">Footer</div>}>
          <p>Modal content</p>
        </Modal>
      )

      const content = screen.getByText('Modal content')
      const footer = screen.getByTestId('footer')

      // Footer should come after content in the DOM
      expect(
        content.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })
  })

  describe('noPadding option', () => {
    it('removes padding when noPadding is true', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} noPadding>
          <p>Content</p>
        </Modal>
      )

      const modalContent = screen.getByTestId('modal-content')
      expect(modalContent).not.toHaveClass('p-6')
    })

    it('has padding by default', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      )

      const modalContent = screen.getByTestId('modal-content')
      expect(modalContent).toHaveClass('p-6')
    })
  })

  describe('backdropInsetRight option', () => {
    it('shifts the dialog wrapper by the offset (single source of truth)', () => {
      // The backdrop and the centered modal are both children of the dialog
      // wrapper with `absolute inset-0`, so insetting the wrapper alone
      // shrinks both — applying the offset to the backdrop too would
      // double-inset it relative to the already-shrunk wrapper.
      render(
        <Modal isOpen={true} onClose={() => {}} backdropInsetRight="28rem">
          <p>Content</p>
        </Modal>
      )

      // Read the inline style, not the computed one: jsdom >=30 resolves
      // computed lengths to pixels, so `toHaveStyle` would compare against
      // `448px`. The two tests below already assert through `.style.right`.
      const dialog = screen.getByRole('dialog')
      expect(dialog.style.right).toBe('28rem')
    })

    it('leaves the backdrop without its own right offset', () => {
      // Regression guard for the double-inset bug: the backdrop must rely on
      // its parent's positioning, not duplicate the inset.
      render(
        <Modal isOpen={true} onClose={() => {}} backdropInsetRight="28rem">
          <p>Content</p>
        </Modal>
      )

      const backdrop = screen.getByTestId('modal-backdrop')
      expect(backdrop.style.right).toBe('')
    })

    it('does not inset the wrapper by default', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog.style.right).toBe('')
    })
  })

  describe('portal rendering (z-index escape)', () => {
    // Regression guard for #1024: the modal must render via createPortal so
    // it escapes the stacking context of any z-[60] panel it may nest inside
    // (e.g. CamperDetailsPanel). Without portaling, the modal's z-50 wrapper
    // sits inside the panel's stacking context and can be visually layered
    // below sibling overlays.
    it('renders into document.body, not the local container', () => {
      const { container } = render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Portal content</p>
        </Modal>
      )

      // The render container should NOT contain the modal — it lives in body
      expect(container.querySelector('[role="dialog"]')).toBeNull()
      // But the modal IS in the document
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('uses z-[100] so it sits above z-[60] panels (e.g. CamperDetailsPanel)', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveClass('z-[100]')
    })
  })

  describe('focus management', () => {
    it('moves focus inside the dialog when it opens', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Focus Test">
          <input placeholder="First field" />
        </Modal>
      )

      const dialog = screen.getByRole('dialog')
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    it('restores focus to the previously focused element when the dialog closes', () => {
      const trigger = document.createElement('button')
      trigger.textContent = 'Open modal'
      document.body.appendChild(trigger)
      trigger.focus()
      expect(document.activeElement).toBe(trigger)

      const { rerender } = render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Modal content</p>
        </Modal>
      )
      expect(document.activeElement).not.toBe(trigger)

      rerender(
        <Modal isOpen={false} onClose={() => {}}>
          <p>Modal content</p>
        </Modal>
      )

      expect(document.activeElement).toBe(trigger)
      trigger.remove()
    })

    it('Tab wraps from the last focusable element to the first', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Wrap Test">
          <input placeholder="Field" />
          <button>Save</button>
        </Modal>
      )

      const saveButton = screen.getByRole('button', { name: 'Save' })
      saveButton.focus()
      expect(document.activeElement).toBe(saveButton)

      fireEvent.keyDown(document, { key: 'Tab' })

      const closeButton = screen.getByRole('button', { name: /close/i })
      expect(document.activeElement).toBe(closeButton)
    })

    it('Shift+Tab wraps from the first focusable element to the last', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Wrap Test">
          <input placeholder="Field" />
          <button>Save</button>
        </Modal>
      )

      const closeButton = screen.getByRole('button', { name: /close/i })
      closeButton.focus()

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })

      const saveButton = screen.getByRole('button', { name: 'Save' })
      expect(document.activeElement).toBe(saveButton)
    })

    it('cycles through every focusable element type, not just buttons', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="All Fields">
          <input placeholder="Text field" />
          <select>
            <option>A</option>
          </select>
          <textarea placeholder="Notes" />
          <a href="#anchor">Link</a>
        </Modal>
      )

      // DOM order: close button, input, select, textarea, link.
      const closeButton = screen.getByRole('button', { name: /close/i })
      expect(document.activeElement).toBe(closeButton)

      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Text field'))

      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement?.tagName).toBe('SELECT')

      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Notes'))

      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Link' }))

      // Wraps back to the close button after the last focusable element.
      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(closeButton)
    })
  })

  describe('background inert', () => {
    // ui/Modal targets `#root` (the app's mount point in index.html) rather
    // than document.body, since document.body also hosts the portal itself —
    // marking body inert would make the dialog inert too. Tests recreate that
    // element since jsdom doesn't load index.html.
    beforeEach(() => {
      const root = document.createElement('div')
      root.id = 'root'
      document.body.appendChild(root)
    })

    afterEach(() => {
      document.getElementById('root')?.remove()
    })

    it('marks the app root inert while the dialog is open', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      )

      expect(document.getElementById('root')).toHaveAttribute('inert')
    })

    it('does not mark the app root inert while the dialog is closed', () => {
      render(
        <Modal isOpen={false} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      )

      expect(document.getElementById('root')).not.toHaveAttribute('inert')
    })

    it('removes inert from the app root once the dialog closes', () => {
      const { rerender } = render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      )
      expect(document.getElementById('root')).toHaveAttribute('inert')

      rerender(
        <Modal isOpen={false} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      )

      expect(document.getElementById('root')).not.toHaveAttribute('inert')
    })
  })

  describe('scrollable option', () => {
    it('applies overflow-y-auto when scrollable is true', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} scrollable>
          <p>Content</p>
        </Modal>
      )

      const contentArea = screen.getByTestId('modal-body')
      expect(contentArea).toHaveClass('overflow-y-auto')
    })

    it('does not have overflow class by default', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      )

      expect(screen.queryByTestId('modal-body')).not.toBeInTheDocument()
    })
  })
})
