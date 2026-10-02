import { useEffect, useRef } from 'react';
import { useOverlayDismiss } from '../hooks/useOverlayDismiss';
import './Modal.css';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  const overlayProps = useOverlayDismiss(onClose);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal">
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

interface PromptModalProps {
  title: string;
  label: string;
  placeholder?: string;
  submitText?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export function PromptModal({
  title,
  label,
  placeholder,
  submitText = 'Create',
  onSubmit,
  onClose,
}: PromptModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = inputRef.current?.value.trim();
    if (value) {
      onSubmit(value);
      onClose();
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <label className="modal-label">{label}</label>
        <input
          ref={inputRef}
          type="text"
          className="modal-input"
          placeholder={placeholder}
        />
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            {submitText}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmText = 'Delete',
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal title={title} onClose={onClose}>
      <p className="modal-message">{message}</p>
      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-danger" onClick={handleConfirm}>
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
