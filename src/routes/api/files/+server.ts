import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  normalizeRelativeDirectory,
  listDirectoryContents,
} from '$lib/server/file-utils';
import { enrichImageMetadata } from '$lib/server/image';
import { enrichVideoDimensions } from '$lib/server/video';
import { logAccess } from '$lib/server/logging';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '$lib/server/constants';
import type { PageSizeOption } from '$lib/server/constants';

function parsePageSize(value: string | null): PageSizeOption | number {
  if (value === 'All') return 'All';
  const pageSize = Number(value ?? DEFAULT_PAGE_SIZE);
  return (PAGE_SIZE_OPTIONS as readonly (PageSizeOption | number)[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
}

export const GET: RequestHandler = async (event) => {
  const { url, request } = event;
  const startedAt = Date.now();
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const pageSize = parsePageSize(url.searchParams.get('pageSize'));
  const view = url.searchParams.get('view') === 'grid' ? 'grid' : 'list';
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  let selectedExtensions = url.searchParams.getAll('ext').map((ext) => ext.toLowerCase());
  const nameFilter = (url.searchParams.get('name_filter') ?? '').trim().toLowerCase();

  let listing = await listDirectoryContents(currentDir, {
    selectedExtensions,
    nameFilter,
  });

  const extensions = listing.extensions;

  let filteredFiles = listing.files;
  if (selectedExtensions.length > 0) {
    if (filteredFiles.length === 0) {
      selectedExtensions = [];
      listing = await listDirectoryContents(currentDir, { nameFilter });
      filteredFiles = listing.files;
    }
  }

  const total = filteredFiles.length;
  const totalSize = filteredFiles.reduce((sum, f) => sum + f.size, 0);
  const pagedFiles = pageSize === 'All'
    ? filteredFiles
    : filteredFiles.slice((page - 1) * (pageSize as number), page * (pageSize as number));
  const totalPages = pageSize === 'All' ? 1 : Math.max(1, Math.ceil(total / (pageSize as number)));

  const totalMedia = filteredFiles.filter(
    (f) => IMAGE_EXTENSIONS.has(f.extension) || VIDEO_EXTENSIONS.has(f.extension),
  ).length;
  const mediaOffset = pageSize === 'All'
    ? 0
    : filteredFiles.slice(0, (page - 1) * (pageSize as number))
        .filter((f) => IMAGE_EXTENSIONS.has(f.extension) || VIDEO_EXTENSIONS.has(f.extension))
        .length;

  await enrichImageMetadata(pagedFiles, { extractTimestamp: view === 'grid' });
  await enrichVideoDimensions(pagedFiles);

  logAccess(event, 'dir_navigation', {
    directory: currentDir || '.', page, page_size: pageSize,
    selected_extensions: selectedExtensions,
    total_directories: listing.directories.length, total_files: total,
    elapsed_ms: Date.now() - startedAt,
  });

  return json({
    directory: currentDir,
    directories: listing.directories,
    files: pagedFiles,
    page,
    pageSize,
    total,
    totalSize,
    totalPages,
    totalMedia,
    mediaOffset,
    pageSizeOptions: [...PAGE_SIZE_OPTIONS],
    selectedExtensions,
    extensions,
  });
};
