export interface UploadCandidate {
  file: File;
  relativePath: string;
}

export interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  fullPath?: string;
  name: string;
}

export interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file: (
    successCallback: (file: File) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
}

export interface FileSystemDirectoryReaderLike {
  readEntries: (
    successCallback: (entries: FileSystemEntryLike[]) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void;
}

export interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader: () => FileSystemDirectoryReaderLike;
}

export type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null;
};

export function normalizeClientRelativeDirectory(relativeDir: string): string {
  const parts = String(relativeDir || '').split('/');
  const normalizedParts: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error('Invalid directory path');
    normalizedParts.push(part);
  }
  return normalizedParts.join('/');
}

export function isWithinConfiguredUploadDir(
  currentDir: string,
  configuredUploadDir: string,
): boolean {
  const normalizedCurrentDir = normalizeClientRelativeDirectory(currentDir);
  const normalizedUploadDir = normalizeClientRelativeDirectory(configuredUploadDir);

  if (!normalizedUploadDir) {
    return true;
  }

  const currentSegments = normalizedCurrentDir ? normalizedCurrentDir.split('/') : [];
  const uploadSegments = normalizedUploadDir.split('/');

  for (let start = 0; start <= currentSegments.length - uploadSegments.length; start += 1) {
    const matchesUploadDir = uploadSegments.every(
      (segment, index) => currentSegments[start + index] === segment,
    );
    if (matchesUploadDir) {
      return true;
    }
  }

  return false;
}

export function normalizeUploadCandidatePath(relativePath: string): string {
  return normalizeClientRelativeDirectory(String(relativePath || '').replaceAll('\\', '/'));
}

export function createUploadCandidatesFromFileList(fileList: FileList | null): UploadCandidate[] {
  if (!fileList?.length) {
    return [];
  }

  return Array.from(fileList)
    .map((file) => {
      const relativePath = normalizeUploadCandidatePath(file.webkitRelativePath || file.name);
      return relativePath ? { file, relativePath } : null;
    })
    .filter((entry): entry is UploadCandidate => !!entry);
}

function readFileEntry(entry: FileSystemFileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readDirectoryEntries(reader: FileSystemDirectoryReaderLike): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function collectEntryUploadCandidates(entry: FileSystemEntryLike): Promise<UploadCandidate[]> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntryLike);
    const relativePath = normalizeUploadCandidatePath(entry.fullPath?.replace(/^\/+/, '') || file.name);
    return relativePath ? [{ file, relativePath }] : [];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const reader = (entry as FileSystemDirectoryEntryLike).createReader();
  const candidates: UploadCandidate[] = [];

  while (true) {
    const childEntries = await readDirectoryEntries(reader);
    if (childEntries.length === 0) {
      break;
    }
    for (const childEntry of childEntries) {
      candidates.push(...(await collectEntryUploadCandidates(childEntry)));
    }
  }

  return candidates;
}

export async function getDropUploadCandidates(dataTransfer: DataTransfer | null): Promise<UploadCandidate[]> {
  if (!dataTransfer) {
    return [];
  }

  const items = Array.from(dataTransfer.items || []) as DataTransferItemWithEntry[];
  const entries = items
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => !!entry);

  if (entries.length === 0) {
    return createUploadCandidatesFromFileList(dataTransfer.files);
  }

  const candidates = await Promise.all(
    entries.map((entry) => collectEntryUploadCandidates(entry as unknown as FileSystemEntryLike)),
  );
  return candidates.flat();
}
