export function hasPathSelected(selectedFiles: Set<string>, path: string): boolean {
  return selectedFiles.has(path);
}

export function areAllItemsSelected(
  selectedFiles: Set<string>,
  items: { path: string }[],
): boolean {
  return items.length > 0 && items.every((item) => selectedFiles.has(item.path));
}

export function areSomeItemsSelected(
  selectedFiles: Set<string>,
  items: { path: string }[],
): boolean {
  return !areAllItemsSelected(selectedFiles, items) && items.some((item) => selectedFiles.has(item.path));
}

export function setSelectedFilePath(
  selectedFiles: Set<string>,
  filePath: string,
  checked: boolean,
): Set<string> {
  if (!filePath) return new Set(selectedFiles);
  const next = new Set(selectedFiles);
  if (checked) next.add(filePath);
  else next.delete(filePath);
  return next;
}

export function setSelectedPaths(
  selectedFiles: Set<string>,
  items: { path: string }[],
  checked: boolean,
): Set<string> {
  let next = new Set(selectedFiles);
  for (const item of items) {
    next = setSelectedFilePath(next, item.path, checked);
  }
  return next;
}

export function summarizeSelection(selectedFiles: Set<string>) {
  return {
    selectedCountText: selectedFiles.size + ' selected',
    selectedFilePaths: [...selectedFiles],
    hasSelection: selectedFiles.size > 0,
  };
}

export function getSelectedTotalSize(
  selectedFiles: Set<string>,
  files: { path: string; size?: number }[],
): number {
  return [...selectedFiles].reduce((sum, path) => {
    const file = files.find((entry) => entry.path === path);
    return sum + (file?.size ?? 0);
  }, 0);
}

export function getCommonImageInfo(
  selectedFiles: Set<string>,
  files: any[],
  isImageFile: (extension: string) => boolean,
) {
  const imageFiles = [...selectedFiles]
    .map((path) => files.find((file) => file.path === path))
    .filter((file): file is any => file && isImageFile(file.extension));
  if (imageFiles.length === 0) return null;

  const firstWidth = Number(imageFiles[0].width);
  const firstHeight = Number(imageFiles[0].height);
  if (!Number.isFinite(firstWidth) || !Number.isFinite(firstHeight) || firstWidth <= 0 || firstHeight <= 0) {
    return null;
  }

  const allSame = imageFiles.every(
    (file) => Number(file.width) === firstWidth && Number(file.height) === firstHeight,
  );
  return allSame ? { width: firstWidth, height: firstHeight } : null;
}

export function getCommonImageExtension(
  selectedFiles: Set<string>,
  files: any[],
  isImageFile: (extension: string) => boolean,
) {
  const imageExtensions = [...selectedFiles]
    .map((path) => files.find((file) => file.path === path))
    .filter((file): file is any => file && isImageFile(file.extension))
    .map((file) => file.extension.toLowerCase());
  if (imageExtensions.length === 0) return null;

  const first = imageExtensions[0];
  return imageExtensions.every((extension) => extension === first) ? first : null;
}

export function countSelectedItems(
  selectedFiles: Set<string>,
  items: { path: string }[],
): number {
  return [...selectedFiles].filter((path) => items.some((item) => item.path === path)).length;
}
