import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import CreateFolderDialog from '../CreateFolderDialog.svelte';

describe('CreateFolderDialog', () => {
  const defaultProps = {
    title: 'New Folder',
    message: 'Enter a name for the new folder.',
    folderName: '',
    errorText: '',
    pending: false,
    onCreate: () => {},
    onCancel: () => {},
  };

  it('renders title', () => {
    render(CreateFolderDialog, defaultProps);
    expect(screen.getByText('New Folder')).toBeTruthy();
  });

  it('renders message', () => {
    render(CreateFolderDialog, defaultProps);
    expect(screen.getByText('Enter a name for the new folder.')).toBeTruthy();
  });

  it('renders Create Folder badge', () => {
    render(CreateFolderDialog, defaultProps);
    const badge = screen.getAllByText('Create Folder').find(el => el.tagName === 'P')!;
    expect(badge).toBeTruthy();
  });

  it('renders folder name input', () => {
    render(CreateFolderDialog, defaultProps);
    const input = screen.getByDisplayValue('');
    expect(input).toBeTruthy();
  });

  it('shows bound folder name value', () => {
    render(CreateFolderDialog, { ...defaultProps, folderName: 'myfolder' });
    const input = screen.getByDisplayValue('myfolder') as HTMLInputElement;
    expect(input.value).toBe('myfolder');
  });

  it('calls onCreate when create button is clicked', () => {
    const onCreate = vi.fn();
    render(CreateFolderDialog, { ...defaultProps, onCreate });
    const buttons = screen.getAllByText('Create Folder').filter(el => el.tagName === 'BUTTON');
    buttons[0].click();
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(CreateFolderDialog, { ...defaultProps, onCancel });
    screen.getByText('Cancel').click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables buttons and input when pending', () => {
    render(CreateFolderDialog, { ...defaultProps, pending: true });
    const createButton = screen.getByText('Creating...') as HTMLButtonElement;
    expect(createButton.disabled).toBe(true);
    const cancelButton = screen.getByText('Cancel') as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(true);
  });

  it('shows error text', () => {
    render(CreateFolderDialog, { ...defaultProps, errorText: 'Folder already exists' });
    expect(screen.getByText('Folder already exists')).toBeTruthy();
  });

  it('calls onCreate on Enter key in input', () => {
    const onCreate = vi.fn();
    render(CreateFolderDialog, { ...defaultProps, onCreate });
    const label = screen.getByText('Folder name');
    const input = label.nextElementSibling as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCreate).toHaveBeenCalledOnce();
  });
});
