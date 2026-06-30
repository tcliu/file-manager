import type { UploadCandidate } from './client-paths';

export interface UploadProgressState {
  label: string;
  value: string;
  width: string;
}

export interface UploadExecutionResult {
  uploadedNames: string[];
  uploadedBytes: number;
}

export function getTotalUploadBytes(uploadCandidates: UploadCandidate[]): number {
  return uploadCandidates.reduce((sum, entry) => sum + entry.file.size, 0);
}

export function createUploadStartStatus(uploadCount: number): string {
  return 'Uploading ' + uploadCount + ' file(s)...';
}

export function createUploadProgressState(input: {
  uploadedBytes: number;
  loadedBytes: number;
  totalUploadBytes: number;
  uploadCount: number;
  formatBytes: (bytes: number) => string;
}): UploadProgressState {
  const percent = Math.min(
    100,
    Math.round(((input.uploadedBytes + input.loadedBytes) / input.totalUploadBytes) * 100),
  );
  const value = percent + '%';

  return {
    width: value,
    value,
    label:
      'Uploading ' +
      input.uploadCount +
      ' file(s): ' +
      input.formatBytes(input.uploadedBytes + input.loadedBytes) +
      ' / ' +
      input.formatBytes(input.totalUploadBytes),
  };
}

export function createUploadCompleteStatus(uploadedNames: string[]): string {
  return 'Uploaded: ' + uploadedNames.join(', ');
}

export function createUploadQuery(currentDir: string): URLSearchParams {
  return new URLSearchParams({ dir: currentDir });
}

export async function uploadCandidateWithXhr(input: {
  candidate: UploadCandidate;
  currentDir: string;
  authHeaders: Record<string, string>;
  onProgress: (loadedBytes: number) => void;
}): Promise<string[]> {
  const formData = new FormData();
  formData.append('files', input.candidate.file, input.candidate.relativePath);
  const query = createUploadQuery(input.currentDir);
  const xhr = new XMLHttpRequest();

  return new Promise<string[]>((resolve, reject) => {
    xhr.open('POST', '/api/upload?' + query.toString());

    for (const [name, value] of Object.entries(input.authHeaders)) {
      xhr.setRequestHeader(name, value);
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        input.onProgress(event.loaded);
      }
    });

    xhr.addEventListener('load', () => {
      const data = JSON.parse(xhr.responseText || '{}');
      if (xhr.status === 401) {
        reject(new Error('Session expired'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(Array.isArray(data.uploaded) ? data.uploaded : []);
        return;
      }
      reject(new Error(data.error ?? 'Upload failed'));
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed.')));
    xhr.send(formData);
  });
}
