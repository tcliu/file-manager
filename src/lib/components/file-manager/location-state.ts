import { normalizeClientRelativeDirectory } from './client-paths';

export interface InitialLocationState {
  directory: string;
  filePath: string;
  zoomValue: string | null;
  selectedExtensions: Set<string>;
  page: number;
  pageSize: number | string;
  filename: string;
}

export function normalizeExtensionValue(value: string): string {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/^\.+/, '');
  return normalized && !normalized.includes('/') ? normalized : '';
}

export function parseSelectedExtensionsParam(values: string[]): Set<string> {
  const extensions = new Set<string>();
  for (const rawValue of values) {
    const normalizedValue = String(rawValue ?? '').trim();
    if (!normalizedValue) continue;
    for (const item of normalizedValue.split(',')) {
      const ext = normalizeExtensionValue(item);
      if (ext) extensions.add(ext);
    }
  }
  return extensions;
}

export function readInitialLocationState(
  normalizeLightboxZoomValue: (value: string | null) => string | null,
): InitialLocationState {
  if (typeof window === 'undefined') {
    return {
      directory: '',
      filePath: '',
      zoomValue: null,
      selectedExtensions: new Set<string>(),
      page: 1,
      pageSize: 20,
      filename: '',
    };
  }

  const url = new URL(window.location.href);
  const relativePath = url.searchParams.get('p') ?? '';
  const filePath = url.searchParams.get('f') ?? '';
  const zoomValue = normalizeLightboxZoomValue(url.searchParams.get('z'));
  const selectedExtensions = parseSelectedExtensionsParam(url.searchParams.getAll('ext'));
  const rawPage = url.searchParams.get('page');
  const rawPageSize = url.searchParams.get('page-size');
  const filename = url.searchParams.get('name_filter') ?? url.searchParams.get('filename') ?? '';

  let page = 1;
  let pageSize: number | string = 20;
  const parsedPage = parseInt(rawPage ?? '', 10);
  if (Number.isFinite(parsedPage) && parsedPage > 0) page = parsedPage;
  if (rawPageSize !== null) {
    if (rawPageSize.toLowerCase() === 'all') {
      pageSize = 'All';
    } else {
      const parsed = parseInt(rawPageSize, 10);
      if (Number.isFinite(parsed) && parsed > 0) pageSize = parsed;
    }
  }

  let directory = '';
  let normalizedFilePath = '';
  try {
    directory = normalizeClientRelativeDirectory(relativePath);
  } catch {
    directory = '';
  }
  try {
    normalizedFilePath = normalizeClientRelativeDirectory(filePath);
  } catch {
    normalizedFilePath = '';
  }
  if (normalizedFilePath) {
    const parts = normalizedFilePath.split('/');
    parts.pop();
    directory = parts.join('/');
  }

  return {
    directory,
    filePath: normalizedFilePath,
    zoomValue,
    selectedExtensions,
    page,
    pageSize,
    filename,
  };
}

export function syncLocationState(input: {
  currentDir: string;
  page: number;
  pageSize: number | string;
  nameFilter: string;
  requestedExtensions: Iterable<string>;
  lightboxOpen: boolean;
  lightboxPath: string;
  lightboxMode: string;
  lightboxZoomValue: string;
}) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (input.currentDir) {
    url.searchParams.set('p', input.currentDir);
  } else {
    url.searchParams.delete('p');
  }
  url.searchParams.set('page', String(input.page));
  url.searchParams.set('page-size', String(input.pageSize));
  if (input.nameFilter) {
    url.searchParams.set('name_filter', input.nameFilter);
  } else {
    url.searchParams.delete('name_filter');
  }
  url.searchParams.delete('filename');
  url.searchParams.delete('ext');
  for (const ext of [...input.requestedExtensions].sort()) {
    url.searchParams.append('ext', ext);
  }
  if (input.lightboxOpen && input.lightboxPath) {
    url.searchParams.set('f', input.lightboxPath);
    if (input.lightboxMode === 'image') {
      url.searchParams.set('z', input.lightboxZoomValue);
    } else {
      url.searchParams.delete('z');
    }
  } else {
    url.searchParams.delete('f');
    url.searchParams.delete('z');
  }

  window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''));
}
