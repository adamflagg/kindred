import { render, screen, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Modal } from './Modal'
import { hasOpenModal } from './modalStack'

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

    it('treats header={null} as "no custom header" — falls through to the floating mark, not a collapsed grid row', () => {
      /*
       * PostValidationResultsModal passes `header={null}` deliberately
       * (alongside `footer={null}`) to get the same floating-button look as
       * the no-header branch. `hasCustomHeader` is
       * `header !== undefined && header !== null` specifically so this
       * falls through rather than grid-stacking an empty header cell, which
       * would collapse the row to the mark's own ~18px height. Nothing else
       * in this suite renders `header={null}`, so a later "simplification"
       * that drops the `&& header !== null` clause would regress that
       * caller silently.
       */
      render(
        <Modal isOpen={true} onClose={() => {}} header={null}>
          <p>Modal content</p>
        </Modal>
      )
      const close = screen.getByRole('button', { name: /close/i })
      expect(close.parentElement?.className).toContain('absolute')
      expect(close.parentElement?.className).toContain('top-4')
      expect(close.parentElement?.className).not.toContain('grid')
    })

    it('renders the close mark as the artifact’s 18px in-flow circle, not the old floated square', () => {
      /*
       * ⚠️ RETARGETED (kindred#2507). This used to pin `top-4` as the
       * default — a 36px button floated at a fixed offset that assumed a
       * header at least 52px tall, with a `closeAlign="center"` opt-in for
       * the one dialog that hit the overhang. Both are gone: every
       * custom-header dialog now draws the design artifact's `.wbtn` — an
       * 18x18 circle pushed to the row's end via `margin-left: auto`
       * (`.mhead .wbtn{margin-left:auto}`) — as the ONLY grammar, not a
       * default plus an opt-in.
       */
      render(
        <Modal isOpen={true} onClose={() => {}} header={<div>Custom Header</div>}>
          <p>Modal content</p>
        </Modal>
      )
      const close = screen.getByRole('button', { name: /close/i })
      expect(close.className).toContain('h-[18px]')
      expect(close.className).toContain('w-[18px]')
      expect(close.className).toContain('rounded-full')
      expect(close.className).toContain('ml-auto')
      expect(close.className).not.toContain('absolute')
      expect(close.className).not.toContain('top-4')
    })

    it('keeps the header slot at its full painted width — a shared flex track was tried and rejected', () => {
      /*
       * A `flex-1` track for the mark leaves the header's own box short of
       * the row's true width: any header painting a full-bleed background
       * (`headerOnDark`) then shows a bare strip of the card's own ground
       * through the mark's transparent fill, where the header's colour
       * should still reach the card's edge (measured, kindred#2507).
       * Grid-stacking — the mark and the header sharing one cell — keeps the
       * header at 100% and lays the mark over it instead, which is what the
       * floated button always did. This pins the container being a grid
       * sharing ONE cell, not a flex row splitting the row into two tracks.
       */
      render(
        <Modal isOpen={true} onClose={() => {}} header={<div>Custom Header</div>}>
          <p>Modal content</p>
        </Modal>
      )
      const row = screen.getByRole('button', { name: /close/i }).parentElement
      expect(row?.className).toContain('grid')
      expect(row?.className).not.toContain('flex-1')
    })

    it('swaps the mark’s border and colour for a dark header, and nothing about its shape', () => {
      // `headerOnDark` predates this issue and stays: a 1px `border-border`
      // line is too low-contrast against a dark gradient, so the dark
      // variant keeps its own translucent-white border and text — see the
      // prop's own doc comment. Only the colour changes; the mark is still
      // the same 18px circle.
      render(
        <Modal isOpen={true} onClose={() => {}} header={<div>Custom Header</div>} headerOnDark>
          <p>Modal content</p>
        </Modal>
      )
      const close = screen.getByRole('button', { name: /close/i })
      expect(close.className).toContain('border-white/30')
      expect(close.className).toContain('text-white/70')
      expect(close.className).not.toContain('border-border')
      expect(close.className).toContain('h-[18px]')
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

    /**
     * ⚠️ THESE THREE PIN TWO MEASURED DEFECTS, NOT A NICETY (found 2026-08-20
     * while comparing `AssignFamilyModal` against its design artifact in a
     * real browser, and reproduced in jsdom before the fix).
     *
     * A child's `autoFocus` LOST every time — React applies it during commit
     * and the focus effect runs after, so `focusable[0]` took it back. In a
     * dialog with a custom `header` that is the CLOSE BUTTON, since Close is
     * rendered above the body: `AssignFamilyModal` opened with focus on
     * Close, where a printable key does nothing and Space or Enter shuts the
     * dialog, while its own doc said "the modal exists to be typed into".
     *
     * And it broke RESTORATION, silently: `previouslyFocusedRef` captures
     * `document.activeElement` in that same effect, by which time `autoFocus`
     * had moved it inside the dialog — so on close the modal restored focus
     * to its own detached field and focus landed on `<body>` instead of on
     * the control that opened it. Probed before the fix: `BODY is NOT the
     * trigger`.
     *
     * `initialFocusRef` closes both. Nothing changes for a dialog that passes
     * none, which the second test pins.
     */
    it('focuses initialFocusRef rather than the Close button', () => {
      function Harness() {
        const ref = useRef<HTMLInputElement>(null)
        return (
          <Modal
            isOpen={true}
            onClose={() => {}}
            header={<h2>Custom header</h2>}
            ariaLabel="Auto"
            initialFocusRef={ref}
          >
            <input ref={ref} placeholder="Search field" />
          </Modal>
        )
      }
      render(<Harness />)
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Search field'))
    })

    it('still lands on the first focusable element when no initialFocusRef is given', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} header={<h2>Custom header</h2>} ariaLabel="Plain">
          <input placeholder="Untouched field" />
        </Modal>
      )
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /close/i }))
    })

    it('restores focus to the opener even when a field was focused on open', () => {
      // The second half of the defect. With `autoFocus` this restored to the
      // dialog's own detached input and focus fell to `<body>`.
      const trigger = document.createElement('button')
      trigger.textContent = 'Assign'
      document.body.appendChild(trigger)
      trigger.focus()
      function Harness({ open }: { open: boolean }) {
        const ref = useRef<HTMLInputElement>(null)
        return (
          <Modal
            isOpen={open}
            onClose={() => {}}
            header={<h2>Custom header</h2>}
            ariaLabel="Auto"
            initialFocusRef={ref}
          >
            <input ref={ref} placeholder="Search field" />
          </Modal>
        )
      }
      const { rerender } = render(<Harness open={true} />)
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Search field'))
      rerender(<Harness open={false} />)
      expect(document.activeElement).toBe(trigger)
      trigger.remove()
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

    it('leaves focus alone on Tab when it is outside the dialog content, so a nested portal (e.g. ConfirmActionPopover rendered as a Modal child, as in AllCamperRequestsModal) keeps its own trap', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Nested Overlay Test">
          <input placeholder="Field" />
        </Modal>
      )

      // Simulate a child that portals outside the dialog's own contentRef
      // subtree, exactly like ConfirmActionPopover does when it is rendered
      // as a child of an open Modal (both portal independently to
      // document.body, so the popover's DOM node is a *sibling* of the
      // modal's content div, not a descendant of it).
      const external = document.createElement('button')
      external.textContent = 'External overlay button'
      document.body.appendChild(external)
      external.focus()
      expect(document.activeElement).toBe(external)

      fireEvent.keyDown(document, { key: 'Tab' })

      // Modal's own trap must not hijack focus meant for the nested
      // overlay's trap — it should no-op when activeElement isn't inside
      // its own content.
      expect(document.activeElement).toBe(external)

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(external)

      external.remove()
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

  describe('Escape ownership when a second `ui/Modal` opens on top (kindred#2205)', () => {
    // `ScenarioManagementModal.tsx` renders exactly this: an outer Modal that
    // is always open, plus a confirmation/edit/create Modal opened on top of
    // it. Both attach their Escape listener to `document`, so without the
    // overlay token stack, one press closed the child AND the parent
    // underneath it in three separate places in that one file.
    function StackedModals({
      onCloseOuter,
      onCloseInner,
    }: {
      onCloseOuter: () => void
      onCloseInner: () => void
    }) {
      return (
        <>
          <Modal isOpen={true} onClose={onCloseOuter} title="Outer">
            <p>Outer content</p>
          </Modal>
          <Modal isOpen={true} onClose={onCloseInner} title="Inner">
            <p>Inner content</p>
          </Modal>
        </>
      )
    }

    it('one Escape closes only the topmost (later-mounted) modal', () => {
      const onCloseOuter = vi.fn()
      const onCloseInner = vi.fn()
      render(<StackedModals onCloseOuter={onCloseOuter} onCloseInner={onCloseInner} />)

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onCloseInner).toHaveBeenCalledTimes(1)
      expect(onCloseOuter).not.toHaveBeenCalled()
    })

    it('a second Escape, after the inner modal is gone, closes the one beneath it', () => {
      const onCloseOuter = vi.fn()
      const onCloseInner = vi.fn()
      const { rerender } = render(
        <StackedModals onCloseOuter={onCloseOuter} onCloseInner={onCloseInner} />
      )

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(onCloseInner).toHaveBeenCalledTimes(1)

      // The real component would stop rendering the inner Modal once its
      // `onClose` fires and the parent flips its `isOpen` state; simulate
      // that here rather than pulling in ScenarioManagementModal's own state.
      rerender(
        <>
          <Modal isOpen={true} onClose={onCloseOuter} title="Outer">
            <p>Outer content</p>
          </Modal>
          <Modal isOpen={false} onClose={onCloseInner} title="Inner">
            <p>Inner content</p>
          </Modal>
        </>
      )

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onCloseOuter).toHaveBeenCalledTimes(1)
      expect(onCloseInner).toHaveBeenCalledTimes(1)
    })

    it('releases its overlay token on unmount, so the stack does not leak', () => {
      // A leaked token would leave `hasOpenModal()` permanently true, which
      // silently disables Escape for every container that stands down while
      // "a modal" is open (`weekend/FamilyDetailsPanel`) — worse than the bug
      // this stack exists to fix.
      const { unmount } = render(
        <Modal isOpen={true} onClose={() => {}} title="Solo">
          <p>Content</p>
        </Modal>
      )
      unmount()

      // The direct assertion: a leaked token leaves the stack non-empty even
      // with nothing open. LIFO ordering means the "fresh modal is still
      // topmost" check below would pass even with a leak underneath it — a
      // newly-acquired token is always last — so it cannot catch a leak on
      // its own; this is the one that actually pins "does not leak".
      expect(hasOpenModal()).toBe(false)

      // A fresh modal opening afterward must be topmost immediately — if the
      // old token were still in the stack, this one's Escape would silently
      // no-op.
      const onClose = vi.fn()
      render(
        <Modal isOpen={true} onClose={onClose} title="Fresh">
          <p>Content</p>
        </Modal>
      )
      fireEvent.keyDown(document, { key: 'Escape' })

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
