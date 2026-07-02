import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CompressDialog from '../CompressDialog.svelte';

describe('CompressDialog', () => {
  const defaultProps = {
    title: 'Compress files',
    message: 'Create a zip archive of the selected items.',
    fileName: 'archive.zip',
    errorText: '',
    pending: false,
    progress: null,
    imageInfo: null,
    imageExtension: null,
    resizeWidth: 0,
    resizeHeight: 0,
    rotation: 0,
    resizeQuality: 100,
    imageFormat: 'jpeg',
    fileCount: 3,
    dirCount: 1,
    totalSize: 1024000,
    formatBytes: (bytes: number) => `${Math.round(bytes / 1024)} KB`,
    onCompress: () => {},
    onCancel: () => {},
  };

  it('renders title', () => {
    render(CompressDialog, defaultProps);
    expect(screen.getByText('Compress files')).toBeTruthy();
  });

  it('renders Zip badge', () => {
    render(CompressDialog, defaultProps);
    const badges = screen.getAllByText(/Zip/i);
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows file and folder counts', () => {
    render(CompressDialog, defaultProps);
    expect(screen.getByText('1 folder')).toBeTruthy();
    expect(screen.getByText('3 files')).toBeTruthy();
  });

  it('shows total size', () => {
    render(CompressDialog, defaultProps);
    expect(screen.getByText('1000 KB')).toBeTruthy();
  });

  it('shows zip filename input', () => {
    render(CompressDialog, defaultProps);
    const input = screen.getByDisplayValue('archive.zip') as HTMLInputElement;
    expect(input.value).toBe('archive.zip');
  });

  it('calls onCancel when cancel is clicked', () => {
    const onCancel = vi.fn();
    render(CompressDialog, { ...defaultProps, onCancel });
    screen.getByText('Cancel').click();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCompress when Zip button is clicked', () => {
    const onCompress = vi.fn();
    render(CompressDialog, { ...defaultProps, onCompress });
    const buttons = screen.getAllByText('Zip');
    const zipButton = buttons.find(b => b.tagName === 'BUTTON')!;
    zipButton.click();
    expect(onCompress).toHaveBeenCalledOnce();
  });

  it('shows pending state', () => {
    render(CompressDialog, { ...defaultProps, pending: true, progress: 50 });
    expect(screen.getByText('Zipping (50%)')).toBeTruthy();
  });

  it('shows error text', () => {
    render(CompressDialog, { ...defaultProps, errorText: 'Not enough space' });
    expect(screen.getByText('Not enough space')).toBeTruthy();
  });

  it('shows image options when imageInfo is provided', () => {
    render(CompressDialog, {
      ...defaultProps,
      imageInfo: { width: 1920, height: 1080 },
      imageExtension: 'jpg',
      resizeWidth: 1920,
      resizeHeight: 1080,
    });
    expect(screen.getByText('Image options')).toBeTruthy();
    expect(screen.getByText('Image Type')).toBeTruthy();
    expect(screen.getByText('Dimensions')).toBeTruthy();
    expect(screen.getByText('Rotation')).toBeTruthy();
    expect(screen.getByText('Quality')).toBeTruthy();
  });

  it('swaps dimensions when rotating 90 degrees', async () => {
    render(CompressDialog, {
      ...defaultProps,
      imageInfo: { width: 1920, height: 1080 },
      imageExtension: 'jpg',
      resizeWidth: 1920,
      resizeHeight: 1080,
    });

    await fireEvent.click(screen.getByLabelText('Rotate 90 degrees'));

    expect((screen.getByLabelText('Resize width') as HTMLInputElement).value).toBe('1080');
    expect((screen.getByLabelText('Resize height') as HTMLInputElement).value).toBe('1920');
  });

  it('does not show image options when imageInfo is null', () => {
    render(CompressDialog, defaultProps);
    expect(screen.queryByText('Image options')).toBeNull();
  });

  it('does not show Image Type when imageExtension is null', () => {
    render(CompressDialog, {
      ...defaultProps,
      imageInfo: { width: 1920, height: 1080 },
      imageExtension: null,
      resizeWidth: 1920,
      resizeHeight: 1080,
    });
    expect(screen.queryByText('Image Type')).toBeNull();
  });
});
