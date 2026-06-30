export interface BreadcrumbItem {
  label: string;
  path: string;
}

export interface FileListingResponse {
  directory: string;
  directories: { name: string; path: string }[];
  files: any[];
  page: number;
  pageSize: number | string;
  total: number;
  totalSize: number;
  totalPages: number;
  totalMedia?: number;
  mediaOffset?: number;
  pageSizeOptions: (number | string)[];
  selectedExtensions: string[];
  extensions?: string[];
}

export function buildFilesQuery(input: {
  currentDir: string;
  page: number;
  pageSize: number | string;
  viewMode: 'list' | 'grid';
  nameFilter: string;
  requestedExtensions: Iterable<string>;
}) {
  const query = new URLSearchParams({
    dir: input.currentDir,
    page: String(input.page),
    pageSize: String(input.pageSize),
    view: input.viewMode,
    name_filter: input.nameFilter,
  });

  for (const extension of [...input.requestedExtensions].sort()) {
    query.append('ext', extension);
  }

  return query;
}

export function buildBreadcrumbs(currentDir: string): BreadcrumbItem[] {
  const segments = currentDir ? currentDir.split('/') : [];
  const items: BreadcrumbItem[] = [{ label: '/', path: '' }];
  let currentPath = '';
  for (const segment of segments) {
    currentPath = currentPath ? currentPath + '/' + segment : segment;
    items.push({ label: segment, path: currentPath });
  }
  return items;
}

export function summarizeListing(data: {
  directories: { name: string; path: string }[];
  files: any[];
  total: number;
  totalSize: number;
}, formatBytes: (bytes: number) => string) {
  return {
    totalItems: data.directories.length + data.total,
    summaryFolderText: data.directories.length > 0 ? data.directories.length + ' folders' : '',
    summaryFileText: data.total > 0 ? data.total + ' files' : '',
    totalSizeText: data.total > 0 ? formatBytes(data.totalSize) : '',
    statusText: data.directories.length || data.files.length ? '' : 'No items found.',
  };
}

export function selectVisibleMediaFiles(
  files: any[],
  isImageFile: (extension: string) => boolean,
  isVideoFile: (extension: string) => boolean,
) {
  return files.filter((file: any) => isImageFile(file.extension) || isVideoFile(file.extension));
}

export function applyListingResponse(input: {
  data: FileListingResponse;
  requestedExtensionsSize: number;
  isImageFile: (extension: string) => boolean;
  isVideoFile: (extension: string) => boolean;
  formatBytes: (bytes: number) => string;
}) {
  const { data } = input;
  const requestedExtensionsCleared = data.selectedExtensions.length === 0 && input.requestedExtensionsSize > 0;
  const visibleMediaFiles = selectVisibleMediaFiles(data.files, input.isImageFile, input.isVideoFile);
  const summary = summarizeListing(data, input.formatBytes);

  return {
    requestedExtensionsCleared,
    availableExtensions: data.extensions ?? [],
    totalItems: summary.totalItems,
    pageSizeOptions: data.pageSizeOptions,
    page: data.page,
    totalPages: data.totalPages,
    currentDir: data.directory,
    visibleMediaFiles,
    totalMedia: data.totalMedia ?? 0,
    mediaOffset: data.mediaOffset ?? 0,
    directories: data.directories,
    files: data.files,
    pageInfoText: String(data.totalPages),
    pageInputValue: String(data.page),
    pageInputMax: String(data.totalPages),
    pageSizeDisplay: String(data.pageSize),
    canGoPrev: data.page > 1,
    canGoNext: data.page < data.totalPages,
    breadcrumbs: buildBreadcrumbs(data.directory),
    summaryFolderText: summary.summaryFolderText,
    summaryFileText: summary.summaryFileText,
    totalSizeText: summary.totalSizeText,
    statusText: summary.statusText,
  };
}

export function toggleRequestedExtension(requestedExtensions: Set<string>, selectedExtensions: Set<string>, extension: string) {
  if (requestedExtensions.has(extension)) {
    requestedExtensions.delete(extension);
    selectedExtensions.delete(extension);
  } else {
    requestedExtensions.add(extension);
    selectedExtensions.add(extension);
  }

  return [...requestedExtensions].sort();
}

export function movePage(currentPage: number, totalPages: number, delta: number): number | null {
  const nextPage = currentPage + delta;
  if (nextPage < 1 || nextPage > totalPages) return null;
  return nextPage;
}
