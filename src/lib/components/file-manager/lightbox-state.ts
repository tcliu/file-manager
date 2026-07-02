export interface LightboxMetaItem {
  key: string;
  text: string;
  badge: boolean;
  class?: string;
}

import { HUE_STYLES, getTagHue } from './tag-colors';

export interface ArchiveBreadcrumbItem {
  label: string;
  path: string;
}

export interface ZoomOption {
  value: string;
  label: string;
  sortValue: number;
}

export function buildArchivePreviewState(
  relativePath: string,
  directories: any[],
  files: any[],
) {
  const rootDirectories = directories.filter((directory: any) => directory.parentPath === relativePath);
  const visibleFiles = files.filter((file: any) => file.parentPath === relativePath);
  const segments = relativePath ? relativePath.split('/') : [];
  const breadcrumbs: ArchiveBreadcrumbItem[] = [{ label: '/', path: '' }];
  let currentPath = '';

  for (const segment of segments) {
    currentPath = currentPath ? currentPath + '/' + segment : segment;
    breadcrumbs.push({ label: segment, path: currentPath });
  }

  return {
    currentDirectory: relativePath,
    rootDirectories,
    files: visibleFiles,
    breadcrumbs,
  };
}

export function buildArchiveLightboxMetaItems(
  file: { extension?: string; size: number },
  formatBytes: (bytes: number) => string,
): LightboxMetaItem[] {
  return [
    { key: 'extension', text: '.' + (file.extension || 'none'), badge: true },
    { key: 'size', text: formatBytes(file.size), badge: false },
  ];
}

export function buildMediaLightboxMetaItems(input: {
  file: any;
  mediaOffset: number;
  lightboxIndex: number;
  totalMedia: number;
  formatBytes: (bytes: number) => string;
  formatDateTime: (value: string) => string;
  formatImageDimensions: (file: any) => string;
  tagIndexMap?: Record<string, number>;
}): LightboxMetaItem[] {
  const dimensionsText = input.formatImageDimensions(input.file);
  const fileTags: string[] = input.file.tags || [];

  return [
    {
      key: 'extension',
      text: '.' + (input.file.extension || 'none'),
      badge: true,
    },
    ...fileTags.map((tag) => {
      const hue = getTagHue(tag, input.tagIndexMap);
      const hueStyles = HUE_STYLES[hue] ?? HUE_STYLES.cyan;
      return {
        key: `tag-${tag}`,
        text: tag,
        badge: true,
        class: hueStyles.chip,
      };
    }),
    {
      key: 'position',
      text: `${input.mediaOffset + input.lightboxIndex + 1} / ${input.totalMedia}`,
      badge: false,
    },
    { key: 'size', text: input.formatBytes(input.file.size), badge: false },
    ...(dimensionsText
      ? [{ key: 'dimensions', text: dimensionsText, badge: false }]
      : []),
    {
      key: 'modified',
      text: input.formatDateTime(input.file.modifiedAt),
      badge: false,
    },
  ];
}

export function buildLightboxZoomOptions(
  fitZoomValue: string,
  zoomLevels: number[],
  fitZoomPercent: number,
): ZoomOption[] {
  const roundedFitZoomPercent = Math.round(fitZoomPercent);
  return [
    {
      value: fitZoomValue,
      label: roundedFitZoomPercent + '%',
      sortValue: fitZoomPercent,
    },
    ...zoomLevels.map((level) => ({
      value: String(level),
      label: level + '%',
      sortValue: level,
    })),
  ].sort((left, right) => left.sortValue - right.sortValue);
}

export function getCurrentLightboxZoomPercent(
  zoomValue: string,
  fitZoomValue: string,
  fitZoomPercent: number,
): number {
  if (zoomValue === fitZoomValue) {
    return fitZoomPercent;
  }
  const parsed = Number(zoomValue);
  return Number.isFinite(parsed) ? parsed : 100;
}
