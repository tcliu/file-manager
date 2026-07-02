import { replaceState } from '$app/navigation';
import { normalizeClientRelativeDirectory } from './client-paths';

export interface InitialLocationState {
  directory: string;
  filePath: string;
  zoomValue: string | null;
  selectedExtensions: Set<string>;
  requestedTags: Set<string>;
  untagged: boolean;
  tagged: boolean;
  page: number;
  pageSize: number | string;
  filename: string;
}

export function parseTagValues(values: string[]): Set<string> {
  const tags = new Set<string>();
  for (const rawValue of values) {
    const normalized = String(rawValue ?? '').trim().toLowerCase();
    if (normalized) tags.add(normalized);
  }
  return tags;
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
      requestedTags: new Set<string>(),
      untagged: false,
      tagged: false,
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
  const requestedTags = parseTagValues(url.searchParams.getAll('tag').filter((t) => t !== 'untagged' && t !== 'tagged'));
  const tagValues = url.searchParams.getAll('tag');
  const untagged = tagValues.includes('untagged');
  const tagged = tagValues.includes('tagged');
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
    requestedTags,
    untagged,
    tagged,
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
  requestedTags: Iterable<string>;
  untagged: boolean;
  tagged: boolean;
  lightboxOpen: boolean;
  lightboxPath: string;
  lightboxMode: string;
  lightboxZoomValue: string;
}) {

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
  url.searchParams.delete('tag');
  for (const tag of [...input.requestedTags].sort()) {
    url.searchParams.append('tag', tag);
  }
  if (input.untagged) {
    url.searchParams.append('tag', 'untagged');
  }
  if (input.tagged) {
    url.searchParams.append('tag', 'tagged');
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

  replaceState(url.pathname + (url.search ? url.search : ''), {});
}
