import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  normalizeRelativeDirectory,
  listDirectoryContents,
  resolveListedDirectoryPath,
} from '$lib/server/file-utils';
import { enrichImageDimensions, enrichGridFileTimestamps } from '$lib/server/image';
import { listExtensions } from '$lib/server/file-utils';
import { logAccess } from '$lib/server/logging';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '$lib/server/constants';
import type { PageSizeOption } from '$lib/server/constants';

function parsePageSize(value: string | null): PageSizeOption | number {
  if (value === 'All') return 'All';
  const pageSize = Number(value ?? DEFAULT_PAGE_SIZE);
  return (PAGE_SIZE_OPTIONS as readonly (PageSizeOption | number)[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
}

export const GET: RequestHandler = async ({ url, request }) => {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const pageSize = parsePageSize(url.searchParams.get('pageSize'));
  const view = url.searchParams.get('view') === 'grid' ? 'grid' : 'list';
  const currentDir = normalizeRelativeDirectory(url.searchParams.get('dir') ?? '');
  const selectedExtensions = url.searchParams.getAll('ext').map((ext) => ext.toLowerCase());

  const listing = await listDirectoryContents(currentDir, selectedExtensions);
  const total = listing.files.length;
  const pagedFiles = pageSize === 'All'
    ? listing.files
    : listing.files.slice((page - 1) * (pageSize as number), page * (pageSize as number));
  const totalPages = pageSize === 'All' ? 1 : Math.max(1, Math.ceil(total / (pageSize as number)));

  await enrichImageDimensions(pagedFiles);

  if (view === 'grid') {
    await enrichGridFileTimestamps(pagedFiles);
  }

  logAccess(request as any, 'dir_navigation', {
    directory: currentDir || '.', page, page_size: pageSize,
    selected_extensions: selectedExtensions,
    total_directories: listing.directories.length, total_files: total,
  });

  return json({
    directory: currentDir,
    directories: listing.directories,
    files: pagedFiles,
    page,
    pageSize,
    total,
    totalPages,
    pageSizeOptions: [...PAGE_SIZE_OPTIONS],
    selectedExtensions,
  });
};
