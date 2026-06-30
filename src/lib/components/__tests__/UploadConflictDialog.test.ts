import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import UploadConflictDialog from '../UploadConflictDialog.svelte';

describe('UploadConflictDialog', () => {
  const defaultProps = {
    title: 'File already exists',
    message: 'A file with this name already exists.',
    fileName: 'photo.jpg',
    errorText: '',
    onRename: () => {},
    onOverwrite: () => {},
    onCancel: () => {},
  };

  it('renders title', () => {
    render(UploadConflictDialog, defaultProps);
    expect(screen.getByText('File already exists')).toBeTruthy();
  });

  it('renders message', () => {
    render(UploadConflictDialog, defaultProps);
    expect(screen.getByText('A file with this name already exists.')).toBeTruthy();
  });

  it('renders Upload Conflict badge', () => {
    render(UploadConflictDialog, defaultProps);
    expect(screen.getByText('Upload Conflict')).toBeTruthy();
  });

  it('renders filename input with default value', () => {
    render(UploadConflictDialog, defaultProps);
    const input = screen.getByDisplayValue('photo.jpg') as HTMLInputElement;
    expect(input.value).toBe('photo.jpg');
  });

  it('calls onRename when rename button is clicked', () => {
    const onRename = vi.fn();
    render(UploadConflictDialog, { ...defaultProps, onRename });
    screen.getByText('Upload New File').click();
    expect(onRename).toHaveBeenCalledOnce();
  });

  it('calls onOverwrite when overwrite button is clicked', () => {
    const onOverwrite = vi.fn();
    render(UploadConflictDialog, { ...defaultProps, onOverwrite });
    screen.getByText('Overwrite').click();
    expect(onOverwrite).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(UploadConflictDialog, { ...defaultProps, onCancel });
    screen.getByText('Cancel').click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows error text', () => {
    render(UploadConflictDialog, { ...defaultProps, errorText: 'Invalid file name' });
    expect(screen.getByText('Invalid file name')).toBeTruthy();
  });
});
