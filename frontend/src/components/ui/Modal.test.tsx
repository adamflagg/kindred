import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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

    it('centres the close button in the header band by default', () => {
      /*
       * ★ DEFAULT FLIPPED, owner ruling 2026-08-21 (kindred#2507).
       *
       * This asserted the OPPOSITE — `top-4` by default — and is rewritten
       * rather than adapted, because the specification changed, not the code.
       *
       * `top-4` is a CONSTANT and header height is not, so a top-anchored
       * button assumes a header at least 52px tall (16px + a 36px box). The
       * wrapper it positions against is the header slot itself, so centring
       * cannot come apart whatever the caller's header height turns out to be.
       *
       * The reason it stayed opt-in until now — "the app's other dialogs were
       * all drawn against `top-4` and moving them is its own review" — was
       * discharged by that review. Measured in Chromium against the real
       * component: Manage Scenarios 16/29 -> 22.5/22.5, Lodging Units 16/36 ->
       * 26/26, Heads Up 16/22.5 -> 19.25/19.25. Centring returns EQUAL gaps at
       * every custom-header dialog measured; `top-4` was visibly high at all
       * of them.
       */
      render(
        <Modal isOpen={true} onClose={() => {}} header={<div>Custom Header</div>}>
          <p>Modal content</p>
        </Modal>
      )
      const close = screen.getByRole('button', { name: /close/i })
      expect(close.className).toContain('top-1/2')
      expect(close.className).toContain('-translate-y-1/2')
      expect(close.className).not.toContain('top-4')
    })

    it('anchors it to the top when a caller opts out', () => {
      // The prop survives the default flip precisely so a header that wants
      // the old behaviour can still say so, rather than being re-litigated.
      render(
        <Modal isOpen={true} onClose={() => {}} header={<div>Custom Header</div>} closeAlign="top">
          <p>Modal content</p>
        </Modal>
      )
      const close = screen.getByRole('button', { name: /close/i })
      expect(close.className).toContain('top-4')
      expect(close.className).not.toContain('top-1/2')
    })

    it('does not treat header={null} as a custom header', () => {
      /*
       * `hasCustomHeader` was `header !== undefined`, and `null !== undefined`
       * is TRUE — so `PostValidationResultsModal`, which passes `header={null}`,
       * rode the custom-header branch with a ZERO-HEIGHT band.
       *
       * `top-4` survived that by luck. Centring on a 0px band computes
       * `0 - 18 = -18px`, putting half the button above the panel's
       * `overflow-hidden` edge: invisible and unclickable. The default flip is
       * what makes this load-bearing, so it ships in the same change.
       */
      render(
        <Modal isOpen={true} onClose={() => {}} header={null}>
          <p>Modal content</p>
        </Modal>
      )
      // Asserted on the BRANCH, not on `top-1/2`: that class is absent under
      // the top anchor too, so it would pass against the very bug this pins.
      // In the custom-header branch the button itself carries `absolute`; in
      // the no-header branch its WRAPPER does and the button does not.
      const close = screen.getByRole('button', { name: /close/i })
      expect(close.className).not.toContain('absolute')
      expect(close.className).not.toContain('top-1/2')
    })

    it('still honours an explicit closeAlign="center", now redundant with the default', () => {
      /*
       * ⚠️ OPT-IN FOR A MEASURED OVERHANG (owner ruling 2026-08-20).
       * `top-4` + a 36px box needs a header at least 52px tall, and it is a
       * constant: a caller that tightens its header makes the button hang
       * past it. `AssignFamilyModal` took the artifact's 14px inset and its
       * header went to 47px, so the button ended 5px past the header's own
       * ground — its hover fill painted across the divider that was there at
       * the time, and its hit area covered the search box's top edge. The
       * later no-rule ruling took the header to 51px and the overhang to 1px;
       * this closes the last of it and, more to the point, stops the geometry
       * depending on a header height nobody is holding still.
       *
       * ⛔ SUPERSEDED 2026-08-21: this was OPT-IN because "moving the others
       * is its own review". That review happened and centring won, so this is
       * now the DEFAULT — kept here as a regression guard that an explicit
       * `"center"` still resolves, since the prop outlives the flip.
       *
       * The 18px in-flow mark that was to be "the standardisation the owner
       * wants" was shown to them and rejected on sight; centring the existing
       * 36px control is what they chose instead.
       */
      render(
        <Modal
          isOpen={true}
          onClose={() => {}}
          header={<div>Custom Header</div>}
          closeAlign="center"
        >
          <p>Modal content</p>
        </Modal>
      )
      const close = screen.getByRole('button', { name: /close/i })
      expect(close.className).toContain('top-1/2')
      expect(close.className).toContain('-translate-y-1/2')
      expect(close.className).not.toContain('top-4')
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
    it('moves focus inside the dialog when it opens', async () => {
      // Async since 1c: focus moves in TransitionChild's beforeEnter (a
      // microtask after commit), not in the [isOpen] effect. This test also
      // pins `appear` — without it, beforeEnter never fires on a dialog that
      // MOUNTS already open, which is 15 of the 24 callers.
      render(
        <Modal isOpen={true} onClose={() => {}} title="Focus Test">
          <input placeholder="First field" />
        </Modal>
      )

      const dialog = screen.getByRole('dialog')
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
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
    it('focuses initialFocusRef rather than the Close button', async () => {
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
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByPlaceholderText('Search field'))
      )
    })

    it('lands on the first focusable element that is NOT the Close button when no initialFocusRef is given (D14)', async () => {
      // REWRITE, not an adaptation — this test used to pin the opposite
      // behaviour (focus landing on Close). That was measured wrong on
      // 2026-08-21: in a custom-header dialog Close is rendered above the
      // body, so 20 of 22 fallback dialogs opened with focus on the one
      // control where Space or Enter SHUTS the dialog. Initial focus now
      // skips the dialog's own Close button; Close stays in the Tab cycle
      // (see the cycling test below), because the skip lives in the initial
      // pick, never in getFocusable.
      render(
        <Modal isOpen={true} onClose={() => {}} header={<h2>Custom header</h2>} ariaLabel="Plain">
          <input placeholder="Untouched field" />
        </Modal>
      )
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByPlaceholderText('Untouched field'))
      )
    })

    it('restores focus to the opener even when a field was focused on open', async () => {
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
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByPlaceholderText('Search field'))
      )
      // The restore itself stays SYNCHRONOUS — D12 keeps release + restore in
      // the [isOpen] effect cleanup, which React runs on this rerender.
      rerender(<Harness open={false} />)
      expect(document.activeElement).toBe(trigger)
      trigger.remove()
    })

    it('restores focus to the previously focused element when the dialog closes', async () => {
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
      await waitFor(() => expect(document.activeElement).not.toBe(trigger))

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

    it('cycles through every focusable element type, not just buttons', async () => {
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

      // DOM order: close button, input, select, textarea, link. Initial
      // focus SKIPS the dialog's own Close button (D14) and lands on the
      // first content control — but Close stays in the Tab cycle below,
      // because the skip lives in the initial pick, never in getFocusable.
      const closeButton = screen.getByRole('button', { name: /close/i })
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByPlaceholderText('Text field'))
      )

      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement?.tagName).toBe('SELECT')

      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Notes'))

      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Link' }))

      // Wraps past the last focusable element back to the CLOSE BUTTON —
      // proof the skip did not remove it from the trap.
      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(closeButton)

      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getByPlaceholderText('Text field'))
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

  describe('transition (spec 1c: fade+scale 200/150, Transition + appear)', () => {
    it('routes pointer events through the wrapper and blocks nothing once dead (2530 review finding 1)', () => {
      // THE pattern: the fixed inset-0 wrapper is pointer-events-none ALWAYS,
      // and the backdrop + panel re-enable with pointer-events-auto. Without
      // this, the dying overlay swallowed clicks for the leave duration —
      // D12's accepted trade was "background interactive" (click-through),
      // and a swallowing overlay is the opposite of that trade.
      render(
        <Modal isOpen={true} onClose={() => {}} title="Hit test">
          <p>Modal content</p>
        </Modal>
      )
      expect(screen.getByRole('dialog').className).toContain('pointer-events-none')
      expect(screen.getByTestId('modal-backdrop').className).toContain('pointer-events-auto')
      expect(screen.getByTestId('modal-content').className).toContain('pointer-events-auto')
    })

    it('turns pointer events OFF on backdrop and panel for the leave', () => {
      // While the exit fade plays, clicks must reach the page beneath — the
      // background was un-inerted on the isOpen flip (D12), and the leave
      // classes are what stop the dying elements intercepting.
      const { rerender } = render(
        <Modal isOpen={true} onClose={() => {}} title="Leave hit test">
          <p>Modal content</p>
        </Modal>
      )
      rerender(
        <Modal isOpen={false} onClose={() => {}} title="Leave hit test">
          <p>Modal content</p>
        </Modal>
      )
      // Still painted on this frame (the linger test below pins that), and
      // already non-interactive.
      expect(screen.getByTestId('modal-backdrop').className).toContain('pointer-events-none')
      expect(screen.getByTestId('modal-content').className).toContain('pointer-events-none')
    })

    it('keeps the dialog painted through the exit and removes it after', async () => {
      // THE pin for the exit animation. Today `if (!isOpen) return null`
      // removes every dialog in the same frame; under <Transition> the DOM
      // must outlive isOpen by the leave duration, then go.
      const { rerender } = render(
        <Modal isOpen={true} onClose={() => {}} title="Linger">
          <p>Modal content</p>
        </Modal>
      )
      expect(screen.getByTestId('modal-content')).toBeInTheDocument()

      rerender(
        <Modal isOpen={false} onClose={() => {}} title="Linger">
          <p>Modal content</p>
        </Modal>
      )
      // Still painted on the frame isOpen flips false...
      expect(screen.getByTestId('modal-content')).toBeInTheDocument()
      // ...and gone once the leave completes (jsdom runs it on its own frame
      // scheduling, ~35-60ms — never the declared 150ms; do not assert time).
      await waitFor(() => expect(screen.queryByTestId('modal-content')).not.toBeInTheDocument())
    })

    it('moves focus inside the dialog when opened by TOGGLING isOpen on a mounted Modal', async () => {
      // The Q12 regression pin, and the single test shape this 7,254-test
      // suite lacked: every prior rerender() in this file goes open->closed,
      // never closed->open. Under <Transition> the panel node does not exist
      // on the commit where isOpen flips true, so a focus effect reading
      // contentRef there focuses NOTHING — invisible until someone tabs.
      // beforeEnter is what closes it; this test fails if that moves or if
      // `appear` is dropped from a code path this shape exercises.
      const { rerender } = render(
        <Modal isOpen={false} onClose={() => {}} title="Toggle">
          <input placeholder="First field" />
        </Modal>
      )
      rerender(
        <Modal isOpen={true} onClose={() => {}} title="Toggle">
          <input placeholder="First field" />
        </Modal>
      )
      await waitFor(() => {
        const dialog = screen.getByRole('dialog')
        expect(dialog.contains(document.activeElement)).toBe(true)
      })
    })

    it('honours initialFocusRef on a toggle open, not only on a mount open', async () => {
      // The ref target lives in the same not-yet-mounted subtree as every
      // other focusable, so initialFocusRef callers share the Q12 failure
      // mode — "1 of 24 is safe" was measured false (2026-08-21 probe).
      function Harness({ open }: { open: boolean }) {
        const ref = useRef<HTMLInputElement>(null)
        return (
          <Modal
            isOpen={open}
            onClose={() => {}}
            header={<h2>Custom header</h2>}
            ariaLabel="Toggle"
            initialFocusRef={ref}
          >
            <input ref={ref} placeholder="Search field" />
          </Modal>
        )
      }
      const { rerender } = render(<Harness open={false} />)
      rerender(<Harness open={true} />)
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByPlaceholderText('Search field'))
      )
    })
  })
})
