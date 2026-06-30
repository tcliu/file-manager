import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ConfirmDialog from '../ConfirmDialog.svelte';

describe('ConfirmDialog', () => {
  const defaultProps = {
    title: 'Delete files?',
    message: 'Are you sure you want to delete 3 files?',
    confirmLabel: 'Delete',
    onConfirm: () => {},
    onCancel: () => {},
  };

  it('renders title', () => {
    render(ConfirmDialog, defaultProps);
    expect(screen.getByText('Delete files?')).toBeTruthy();
  });

  it('renders message', () => {
    render(ConfirmDialog, defaultProps);
    expect(screen.getByText('Are you sure you want to delete 3 files?')).toBeTruthy();
  });

  it('renders confirm button with label', () => {
    render(ConfirmDialog, defaultProps);
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('renders cancel button', () => {
    render(ConfirmDialog, defaultProps);
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(ConfirmDialog, { ...defaultProps, onConfirm });
    screen.getByText('Delete').click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(ConfirmDialog, { ...defaultProps, onCancel });
    screen.getByText('Cancel').click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(ConfirmDialog, { ...defaultProps, onCancel });
    const backdrop = document.querySelector('.fixed.inset-0') as HTMLElement;
    backdrop.click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows Confirm Delete badge', () => {
    render(ConfirmDialog, defaultProps);
    expect(screen.getByText('Confirm Delete')).toBeTruthy();
  });
});
