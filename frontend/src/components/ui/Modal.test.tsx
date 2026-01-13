import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Modal } from './Modal';

describe('Modal', () => {
  describe('when isOpen is false', () => {
    it('renders nothing', () => {
      const { container } = render(
        <Modal isOpen={false} onClose={() => {}}>
          <p>Modal content</p>
        </Modal>
      );

      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('when isOpen is true', () => {
    it('renders the modal content', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Modal content</p>
        </Modal>
      );

      expect(screen.getByText('Modal content')).toBeInTheDocument();
    });

    it('renders the title when provided', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Test Title">
          <p>Modal content</p>
        </Modal>
      );

      expect(screen.getByText('Test Title')).toBeInTheDocument();
    });

    it('does not render title when not provided', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Modal content</p>
        </Modal>
      );

      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={onClose}>
          <p>Modal content</p>
        </Modal>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when backdrop is clicked', () => {
      const onClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={onClose}>
          <p>Modal content</p>
        </Modal>
      );

      const backdrop = screen.getByTestId('modal-backdrop');
      fireEvent.click(backdrop);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close when modal content is clicked', () => {
      const onClose = vi.fn();
      render(
        <Modal isOpen={true} onClose={onClose}>
          <p>Modal content</p>
        </Modal>
      );

      // Click on the modal content, not the backdrop
      const content = screen.getByText('Modal content');
      fireEvent.click(content);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('size variants', () => {
    it('applies sm size class', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} size="sm">
          <p>Small modal</p>
        </Modal>
      );

      const modalContent = screen.getByTestId('modal-content');
      expect(modalContent).toHaveClass('max-w-md');
    });

    it('applies md size class (default)', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Medium modal</p>
        </Modal>
      );

      const modalContent = screen.getByTestId('modal-content');
      expect(modalContent).toHaveClass('max-w-lg');
    });

    it('applies lg size class', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} size="lg">
          <p>Large modal</p>
        </Modal>
      );

      const modalContent = screen.getByTestId('modal-content');
      expect(modalContent).toHaveClass('max-w-2xl');
    });

    it('applies xl size class', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} size="xl">
          <p>Extra large modal</p>
        </Modal>
      );

      const modalContent = screen.getByTestId('modal-content');
      expect(modalContent).toHaveClass('max-w-4xl');
    });
  });

  describe('accessibility', () => {
    it('has appropriate role for dialog', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Accessible Modal">
          <p>Modal content</p>
        </Modal>
      );

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('close button is accessible', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Modal content</p>
        </Modal>
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toBeInTheDocument();
    });
  });

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
      );

      expect(screen.getByTestId('custom-header')).toBeInTheDocument();
      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

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
      );

      expect(screen.getByText('Custom Header Only')).toBeInTheDocument();
      expect(screen.queryByText('Should Not Appear')).not.toBeInTheDocument();
    });

    it('still shows close button with custom header', () => {
      render(
        <Modal
          isOpen={true}
          onClose={() => {}}
          header={<div>Custom Header</div>}
        >
          <p>Modal content</p>
        </Modal>
      );

      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });
  });

  describe('footer slot', () => {
    it('renders footer content', () => {
      render(
        <Modal
          isOpen={true}
          onClose={() => {}}
          footer={<button>Save</button>}
        >
          <p>Modal content</p>
        </Modal>
      );

      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });

    it('renders footer after content', () => {
      render(
        <Modal
          isOpen={true}
          onClose={() => {}}
          footer={<div data-testid="footer">Footer</div>}
        >
          <p>Modal content</p>
        </Modal>
      );

      const content = screen.getByText('Modal content');
      const footer = screen.getByTestId('footer');

      // Footer should come after content in the DOM
      expect(content.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('noPadding option', () => {
    it('removes padding when noPadding is true', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} noPadding>
          <p>Content</p>
        </Modal>
      );

      const modalContent = screen.getByTestId('modal-content');
      expect(modalContent).not.toHaveClass('p-6');
    });

    it('has padding by default', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      );

      const modalContent = screen.getByTestId('modal-content');
      expect(modalContent).toHaveClass('p-6');
    });
  });

  describe('scrollable option', () => {
    it('applies overflow-y-auto when scrollable is true', () => {
      render(
        <Modal isOpen={true} onClose={() => {}} scrollable>
          <p>Content</p>
        </Modal>
      );

      const contentArea = screen.getByTestId('modal-body');
      expect(contentArea).toHaveClass('overflow-y-auto');
    });

    it('does not have overflow class by default', () => {
      render(
        <Modal isOpen={true} onClose={() => {}}>
          <p>Content</p>
        </Modal>
      );

      expect(screen.queryByTestId('modal-body')).not.toBeInTheDocument();
    });
  });
});
