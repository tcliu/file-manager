<script lang="ts">
  import Login from './Login.svelte';
  import Lightbox from './Lightbox.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import UploadConflictDialog from './UploadConflictDialog.svelte';

  interface Props {
    auth: { enabled: boolean; sessionExpiryMs: number; sessionExpiryLabel: string; username: string };
    uploadDir: string;
    imageExtensions: string[];
    videoExtensions: string[];
    thumbnailSupportedExtensions: string[];
  }

  let { auth, uploadDir, imageExtensions, videoExtensions, thumbnailSupportedExtensions }: Props = $props();

  const SESSION_STORAGE_KEY = 'file-manager-auth';
  const REMEMBER_ME_STORAGE_KEY = 'file-manager-remembered-login';
  const LIGHTBOX_FIT_ZOOM_VALUE = 'fit';
  const LIGHTBOX_ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300];

  const authEnabled = $derived(auth.enabled);
  const authUsername = $derived(auth.username);
  const sessionExpiryMs = $derived(auth.sessionExpiryMs);
  const sessionExpiryLabel = $derived(auth.sessionExpiryLabel);

  // svelte-ignore state_referenced_locally
  let showLoginShell = $state(authEnabled);
  // svelte-ignore state_referenced_locally
  let showAppShell = $state(!authEnabled);
  let loginPending = $state(false);
  // svelte-ignore state_referenced_locally
  let loginUsername = $state(authUsername);
  let loginPassword = $state('');
  let rememberMe = $state(false);
  let passwordVisible = $state(false);
  let loginStatusText = $state('');
  // svelte-ignore state_referenced_locally
  let sessionInfoText = $state(authEnabled ? '' : 'Authentication disabled');
  let summaryText = $state('');
  let selectedCountText = $state('0 selected');
  let statusText = $state('');
  let pageInfoText = $state('');
  let pageInputValue = $state('1');
  let pageInputMax = $state('1');
  let pageSizeOptions: (number | string)[] = $state([]);
  let pageSizeMenuOpen = $state(false);
  let pageSizeDisplay = $state('20');
  let viewMode = $state<'list' | 'grid'>('grid');
  let breadcrumbs: { label: string; path: string }[] = $state([{ label: '/', path: '' }]);
  let availableExtensions: string[] = $state([]);
  let selectedExtensionsList: string[] = $state([]);
  let directories: { name: string; path: string }[] = $state([]);
  let files: any[] = $state([]);
  let selectedFilePaths: string[] = $state([]);
  let hasSelection = $state(false);
  let zipPending = $state(false);
  let deletePending = $state(false);
  let canGoPrev = $state(false);
  let canGoNext = $state(false);
  let uploadProgressVisible = $state(false);
  let uploadBusy = $state(false);
  let dropzoneActive = $state(false);
  let loadFilesRequestId = 0;
  let fileInputVersion = $state(0);
  let fileInputOpenToken = $state(0);
  let fileInputLastHandled = 0;
  let fileInputRef = $state<HTMLInputElement | null>(null);
  let pageSizeContainerRef = $state<HTMLDivElement | null>(null);
  let uploadProgressLabel = $state('Uploading...');
  let uploadProgressValue = $state('0%');
  let uploadProgressWidth = $state('0%');

  let confirmDialogOpen = $state(false);
  let confirmDialogTitleText = $state('Delete selected files?');
  let confirmDialogMessageText = $state('This action cannot be undone.');
  let confirmDialogConfirmLabel = $state('Delete');

  let uploadConflictDialogOpen = $state(false);
  let uploadConflictDialogTitleText = $state('File already exists');
  let uploadConflictDialogMessageText = $state('Choose whether to overwrite the existing file or upload with a different name.');
  let uploadConflictFileName = $state('');
  let uploadConflictDialogErrorText = $state('');

  let lightboxOpen = $state(false);
  let lightboxMode = $state('');
  let lightboxPathValue = $state('');
  let lightboxImageUrl = $state('');
  let lightboxVideoUrl = $state('');
  let lightboxVideoReady = $state(false);
  let lightboxVideoProgressLabel = $state('Preparing video for browser playback...');
  let lightboxVideoProgressValue = $state('0%');
  let lightboxVideoProgressWidth = $state('0%');
  let lightboxVideoErrorText = $state('');
  let lightboxZipRootDirectories: { name: string; path: string; parentPath: string }[] = $state([]);
  let lightboxZipFiles: any[] = $state([]);
  let lightboxZipCurrentDirectory = $state('');
  let lightboxZipBreadcrumbs: { label: string; path: string }[] = $state([{ label: '/', path: '' }]);
  let lightboxZipLoading = $state(false);
  let lightboxZipErrorText = $state('');
  let lightboxImageAlt = $state('');
  let lightboxTitleValue = $state('');
  let lightboxMetaItems: { key: string; text: string; badge: boolean }[] = $state([]);
  let lightboxPrevDisabled = $state(false);
  let lightboxNextDisabled = $state(false);
  let lightboxZoomValue = $state('fit');
  let lightboxZoomMenuOpen = $state(false);
  let lightboxZoomInDisabled = $state(false);
  let lightboxZoomOutDisabled = $state(true);
  let lightboxCanPan = $state(false);
  let lightboxDragging = $state(false);
  let lightboxImageStyle: Record<string, string> = $state({});
  let lightboxVideoStyle: Record<string, string> = $state({});
  let lightboxZoomOptions: { value: string; label: string; sortValue: number }[] = $state([]);
  let lightboxZoomLabel = $state('Fit');

  const ui = $state({
    page: 1,
    pageSize: 20 as number | string,
    totalPages: 1,
    currentDir: '',
    selectedFiles: new Set<string>(),
    requestedExtensions: new Set<string>(),
    selectedExtensions: new Set<string>(),
    visibleMediaFiles: [] as any[],
    lightboxIndex: -1,
    lightboxPath: '',
    lightboxLoadToken: 0,
    isUploading: false,
    lightboxImageNaturalWidth: 0,
    lightboxImageNaturalHeight: 0,
    lightboxVideoNaturalWidth: 0,
    lightboxVideoNaturalHeight: 0,
    pendingLightboxDirection: 0,
    confirmDialogResolver: null as ((result: boolean) => void) | null,
    uploadConflictDialogResolver: null as ((result: any) => void) | null,
    lightboxPanPointerId: null as number | null,
    lightboxPanStartX: 0,
    lightboxPanStartY: 0,
    lightboxPanScrollLeft: 0,
    lightboxPanScrollTop: 0,
    lightboxPanMoved: false,
  });

  function isImageFile(extension: string): boolean {
    return imageExtensions.includes(String(extension || '').toLowerCase());
  }

  function isVideoFile(extension: string): boolean {
    return videoExtensions.includes(String(extension || '').toLowerCase());
  }

  function isZipFile(extension: string): boolean {
    return String(extension || '').toLowerCase() === 'zip';
  }

  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let index = 0;
    while (value >= 1000 && index < units.length - 1) { value /= 1000; index += 1; }
    return (value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[index];
  }

  function formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  function formatImageDimensions(file: any): string {
    const width = Number(file?.width);
    const height = Number(file?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
    return width + ' x ' + height;
  }

  function getAuthHeaders(): Record<string, string> {
    const session = readSession();
    if (!session) return {};
    return { 'x-session-token': session.token };
  }

  function readSession(): { username: string; token: string; expiresAt: number } | null {
    if (!authEnabled) {
      return { username: authUsername || 'Guest', token: '', expiresAt: Date.now() + sessionExpiryMs };
    }
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      if (typeof session.expiresAt !== 'number' || typeof session.token !== 'string' || !session.token || Date.now() >= session.expiresAt) {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
      }
      return session;
    } catch {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
  }

  function writeSession(username: string, token: string) {
    const session = { username, token, expiresAt: Date.now() + sessionExpiryMs };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  function updateSessionInfo() {
    if (!authEnabled) { sessionInfoText = 'Authentication disabled'; return; }
    const session = readSession();
    if (!session) { sessionInfoText = 'Session expired'; return; }
    const remainingMinutes = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 60000));
    sessionInfoText = session.username + ' \u2022 expires in ' + remainingMinutes + ' min';
  }

  function forceLogout(message = 'Session ended. Please log in again.') {
    if (!authEnabled) { statusText = message; showApp(); return; }
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    ui.selectedFiles.clear();
    loginStatusText = message;
    showLogin();
  }

  function showLogin() {
    if (!authEnabled) { showApp(); return; }
    showLoginShell = true;
    showAppShell = false;
    updateSessionInfo();
    passwordVisible = false;
  }

  function showApp() {
    showLoginShell = false;
    showAppShell = true;
    updateSessionInfo();
  }

  async function handleLogin() {
    loginPending = true;
    loginStatusText = 'Signing in...';
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });
      const data = await response.json().catch(() => ({}));
      loginPending = false;
      if (!response.ok) { loginStatusText = data.error ?? 'Login failed'; return; }
      writeSession(loginUsername, data.token);
      loginStatusText = '';
      showApp();
      await initializeApp();
    } catch (error) {
      loginPending = false;
      loginStatusText = 'Login failed';
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/logout', { method: 'POST', headers: getAuthHeaders() });
    } catch {}
    forceLogout();
  }

  async function initializeApp() {
    selectedExtensionsList = [...ui.requestedExtensions].sort();
    updateSelectedCount();
    await loadExtensions();
    await loadFiles();
  }

  async function loadExtensions() {
    const query = new URLSearchParams({ dir: ui.currentDir });
    const response = await fetch('/api/extensions?' + query.toString(), { headers: getAuthHeaders() });
    if (response.status === 401) { forceLogout('Session expired: please log in again'); return; }
    const data = await response.json();
    availableExtensions = data.extensions;
    selectedExtensionsList = [...ui.requestedExtensions].sort();
  }

  async function loadFiles() {
    if (!readSession()) { forceLogout('Session expired: please log in again'); return; }
    updateSessionInfo();
    statusText = 'Loading files...';
    const query = new URLSearchParams({ dir: ui.currentDir, page: String(ui.page), pageSize: String(ui.pageSize), view: viewMode });
    for (const extension of [...ui.requestedExtensions].sort()) query.append('ext', extension);
    const requestId = ++loadFilesRequestId;
    const response = await fetch('/api/files?' + query.toString(), { headers: getAuthHeaders() });
    if (requestId !== loadFilesRequestId) return;
    if (response.status === 401) { forceLogout('Session expired: please log in again'); return; }
    const data = await response.json();
    if (requestId !== loadFilesRequestId) return;
    pageSizeOptions = data.pageSizeOptions;
    ui.page = data.page;
    ui.totalPages = data.totalPages;
    ui.currentDir = data.directory;
    ui.visibleMediaFiles = data.files.filter((f: any) => isImageFile(f.extension));
    directories = data.directories;
    files = data.files;
    pageInfoText = String(data.totalPages);
    pageInputValue = String(data.page);
    pageInputMax = String(data.totalPages);
    pageSizeDisplay = String(data.pageSize);
    pageSizeMenuOpen = false;
    canGoPrev = data.page > 1;
    canGoNext = data.page < data.totalPages;
    syncBreadcrumbState();
    summaryText = data.directories.length + ' folders, ' + data.total + ' files';
    updateSelectedCount();
    statusText = (data.directories.length || data.files.length) ? '' : 'No items found.';
  }

  function syncBreadcrumbState() {
    const segments = ui.currentDir ? ui.currentDir.split('/') : [];
    const items: { label: string; path: string }[] = [{ label: '/', path: '' }];
    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? currentPath + '/' + segment : segment;
      items.push({ label: segment, path: currentPath });
    }
    breadcrumbs = items;
  }

  function updateSelectedCount() {
    selectedCountText = ui.selectedFiles.size + ' selected';
    selectedFilePaths = [...ui.selectedFiles];
    hasSelection = ui.selectedFiles.size > 0;
  }

  function setFileSelection(filePath: string, checked: boolean) {
    if (!filePath) return;
    if (checked) ui.selectedFiles.add(filePath);
    else ui.selectedFiles.delete(filePath);
    updateSelectedCount();
  }

  function toggleExtensionSelection(extension: string) {
    if (ui.requestedExtensions.has(extension)) {
      ui.requestedExtensions.delete(extension);
      ui.selectedExtensions.delete(extension);
    } else {
      ui.requestedExtensions.add(extension);
      ui.selectedExtensions.add(extension);
    }
    selectedExtensionsList = [...ui.requestedExtensions].sort();
    ui.page = 1;
    loadExtensions().then(() => loadFiles());
  }

  function navigateToDirectory(relativePath: string) {
    if (!readSession()) { forceLogout('Session expired: please log in again'); return; }
    if (ui.currentDir !== relativePath) { ui.selectedFiles.clear(); updateSelectedCount(); }
    ui.currentDir = relativePath;
    ui.page = 1;
    loadExtensions().then(() => loadFiles());
  }

  function changePageBy(delta: number) {
    const nextPage = ui.page + delta;
    if (nextPage < 1 || nextPage > ui.totalPages) return;
    ui.page = nextPage;
    loadFiles();
  }

  function setViewMode(mode: 'list' | 'grid') {
    viewMode = mode;
    ui.page = 1;
    loadFiles();
  }

  function getMediaUrl(filePath: string): string {
    const query = new URLSearchParams({ path: filePath });
    const session = readSession();
    if (authEnabled && session?.token) query.set('token', session.token);
    return '/media?' + query.toString();
  }

  function getThumbnailUrl(filePath: string): string {
    const query = new URLSearchParams({ path: filePath });
    const session = readSession();
    if (authEnabled && session?.token) query.set('token', session.token);
    return '/thumbnail?' + query.toString();
  }

  function getDownloadUrl(filePath: string): string {
    const query = new URLSearchParams({ path: filePath });
    const session = readSession();
    if (authEnabled && session?.token) query.set('token', session.token);
    return '/download?' + query.toString();
  }

  async function uploadFiles(fileList: FileList | null) {
    if (!readSession()) { forceLogout('Session expired: please log in again'); return; }
    if (ui.isUploading || !fileList || !fileList.length) return;

    const totalUploadBytes = Array.from(fileList).reduce((sum, f) => sum + f.size, 0);
    ui.isUploading = true;
    uploadBusy = true;
    uploadProgressVisible = true;
    statusText = 'Uploading ' + fileList.length + ' file(s)...';

    let uploadedBytes = 0;
    const uploadedNames: string[] = [];

    try {
      for (const file of Array.from(fileList)) {
        const formData = new FormData();
        formData.append('files', file, file.name);
        const query = new URLSearchParams({ dir: ui.currentDir });

        const xhr = new XMLHttpRequest();
        await new Promise<void>((resolve, reject) => {
          xhr.open('POST', '/api/upload?' + query.toString());
          for (const [name, value] of Object.entries(getAuthHeaders())) xhr.setRequestHeader(name, value);
          xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable) {
              const percent = Math.min(100, Math.round(((uploadedBytes + event.loaded) / totalUploadBytes) * 100));
              uploadProgressWidth = percent + '%';
              uploadProgressValue = percent + '%';
              uploadProgressLabel = 'Uploading ' + fileList.length + ' file(s): ' + formatBytes(uploadedBytes + event.loaded) + ' / ' + formatBytes(totalUploadBytes);
            }
          });
          xhr.addEventListener('load', () => {
            const data = JSON.parse(xhr.responseText || '{}');
            if (xhr.status === 401) { reject(new Error('Session expired')); return; }
            if (xhr.status >= 200 && xhr.status < 300) {
              uploadedBytes += file.size;
              uploadedNames.push(...data.uploaded);
              resolve();
            } else {
              reject(new Error(data.error ?? 'Upload failed'));
            }
          });
          xhr.addEventListener('error', () => reject(new Error('Upload failed.')));
          xhr.send(formData);
        });
      }

      fileInputVersion += 1;
      await loadExtensions();
      await loadFiles();
      statusText = 'Uploaded: ' + uploadedNames.join(', ');
    } catch (error: any) {
      if (error.message === 'Session expired') { forceLogout('Session expired: please log in again'); return; }
      statusText = error.message || 'Upload failed.';
    } finally {
      ui.isUploading = false;
      uploadBusy = false;
      uploadProgressVisible = false;
      uploadProgressWidth = '0%';
    }
  }

  async function createSelectionZip() {
    if (!readSession()) { forceLogout('Session expired: please log in again'); return; }
    if (!ui.selectedFiles.size) { statusText = 'Select at least one file first'; return; }
    zipPending = true;
    statusText = 'Creating zip from selected items...';
    const query = new URLSearchParams({ dir: ui.currentDir });
    const response = await fetch('/api/zip-selection?' + query.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ items: [...ui.selectedFiles] }),
    });
    zipPending = false;
    if (!response.ok) { const data = await response.json().catch(() => ({})); statusText = data.error ?? 'Failed to create zip file'; return; }
    const blob = await response.blob();
    const contentDisposition = response.headers.get('content-disposition');
    const match = contentDisposition?.match(/filename="([^"]+)"/i);
    const fileName = match ? match[1] : 'download.zip';
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(downloadUrl);
    ui.selectedFiles.clear();
    updateSelectedCount();
    statusText = 'Downloaded zip: ' + fileName;
  }

  function openConfirmDialog(options: { title: string; message: string; confirmLabel: string }): Promise<boolean> {
    confirmDialogTitleText = options.title;
    confirmDialogMessageText = options.message;
    confirmDialogConfirmLabel = options.confirmLabel;
    confirmDialogOpen = true;
    return new Promise((resolve) => { ui.confirmDialogResolver = resolve; });
  }

  function closeConfirmDialog(result: boolean) {
    if (!ui.confirmDialogResolver) return;
    const resolve = ui.confirmDialogResolver;
    ui.confirmDialogResolver = null;
    confirmDialogOpen = false;
    resolve(result);
  }

  function openUploadConflictDialog(fileName: string, suggestedName: string): Promise<{ action: string; fileName?: string }> {
    uploadConflictDialogTitleText = 'File already exists';
    uploadConflictDialogMessageText = 'A file named "' + fileName + '" already exists. Overwrite it or upload with a different name.';
    uploadConflictFileName = suggestedName;
    uploadConflictDialogErrorText = '';
    uploadConflictDialogOpen = true;
    return new Promise((resolve) => { ui.uploadConflictDialogResolver = resolve; });
  }

  function closeUploadConflictDialog(result: { action: string; fileName?: string }) {
    if (!ui.uploadConflictDialogResolver) return;
    const resolve = ui.uploadConflictDialogResolver;
    ui.uploadConflictDialogResolver = null;
    uploadConflictDialogOpen = false;
    uploadConflictDialogErrorText = '';
    resolve(result);
  }

  async function deleteSelectedFiles() {
    if (!readSession()) { forceLogout('Session expired: please log in again'); return; }
    if (!ui.selectedFiles.size) { statusText = 'Select at least one file first'; return; }
    const confirmed = await openConfirmDialog({
      title: 'Delete selected items?',
      message: 'Delete ' + ui.selectedFiles.size + ' selected item(s)? Directories can only be deleted under upload. This action cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    deletePending = true;
    statusText = 'Deleting selected files...';
    const query = new URLSearchParams({ dir: ui.currentDir });
    const response = await fetch('/api/delete-selection?' + query.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ items: [...ui.selectedFiles] }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { deletePending = false; statusText = data.error ?? 'Failed to delete selected files'; return; }
    ui.selectedFiles.clear();
    updateSelectedCount();
    deletePending = false;
    statusText = 'Deleted ' + data.deleted.length + ' item(s)';
    await loadExtensions();
    await loadFiles();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (confirmDialogOpen) { closeConfirmDialog(false); return; }
      if (uploadConflictDialogOpen) { closeUploadConflictDialog({ action: 'cancel' }); return; }
      if (lightboxOpen) { closeLightbox(); return; }
    }
    if (event.key === 'ArrowLeft' && !lightboxOpen && canGoPrev) { changePageBy(-1); }
    if (event.key === 'ArrowRight' && !lightboxOpen && canGoNext) { changePageBy(1); }
    if (event.key === 'ArrowUp' && lightboxOpen && lightboxMode === 'image') {
      event.preventDefault();
      nudgeLightboxZoom(1);
      return;
    }
    if (event.key === 'ArrowDown' && lightboxOpen && lightboxMode === 'image') {
      event.preventDefault();
      nudgeLightboxZoom(-1);
    }
  }

  function openLightbox(filePath: string) {
    const currentFile = files.find((f: any) => f.path === filePath);
    if (!currentFile) return;
    if (isZipFile(currentFile.extension)) {
      openArchiveLightbox(currentFile);
      return;
    }
    if (isVideoFile(currentFile.extension)) return;
    const nextIndex = ui.visibleMediaFiles.findIndex((f: any) => f.path === filePath);
    if (nextIndex === -1) return;
    ui.lightboxIndex = nextIndex;
    ui.lightboxPath = filePath;
    lightboxOpen = true;
    setBodyScrollLocked(true);
    resetLightboxZoom();
    syncLightboxState();
  }

  function closeLightbox() {
    ui.lightboxIndex = -1;
    ui.lightboxPath = '';
    ui.lightboxLoadToken += 1;
    lightboxOpen = false;
    lightboxMode = '';
    lightboxPathValue = '';
    lightboxImageUrl = '';
    lightboxVideoUrl = '';
    lightboxVideoReady = false;
    lightboxImageAlt = '';
    lightboxTitleValue = '';
    lightboxMetaItems = [];
    resetLightboxZoom();
    lightboxImageStyle = {};
    lightboxCanPan = false;
    lightboxDragging = false;
    ui.lightboxImageNaturalWidth = 0;
    ui.lightboxImageNaturalHeight = 0;
    setBodyScrollLocked(false);
  }

  function syncLightboxState() {
    const currentFile = ui.visibleMediaFiles[ui.lightboxIndex];
    if (!currentFile) { closeLightbox(); return; }
    ui.lightboxPath = currentFile.path;
    lightboxPathValue = currentFile.path;
    const isImage = isImageFile(currentFile.extension);
    const isVideo = isVideoFile(currentFile.extension);
    lightboxMode = isVideo ? 'video' : isImage ? 'image' : '';
    lightboxImageUrl = isImage ? getMediaUrl(currentFile.path) : '';
    lightboxVideoUrl = '';
    lightboxVideoReady = false;
    lightboxImageAlt = isImage ? currentFile.name : '';
    lightboxTitleValue = currentFile.name;
    lightboxMetaItems = [
      { key: 'extension', text: '.' + (currentFile.extension || 'none'), badge: true },
      { key: 'size', text: formatBytes(currentFile.size), badge: false },
      ...(isImage && formatImageDimensions(currentFile) ? [{ key: 'dimensions', text: formatImageDimensions(currentFile), badge: false }] : []),
      { key: 'modified', text: formatDateTime(currentFile.modifiedAt), badge: false },
    ];
    lightboxPrevDisabled = ui.page <= 1 && ui.lightboxIndex <= 0;
    lightboxNextDisabled = ui.page >= ui.totalPages && ui.lightboxIndex >= ui.visibleMediaFiles.length - 1;
    ui.lightboxImageNaturalWidth = 0;
    ui.lightboxImageNaturalHeight = 0;
    resetLightboxZoom();
    if (isVideo) prepareLightboxVideo(currentFile);
  }

  async function prepareLightboxVideo(file: any) {
    const query = new URLSearchParams({ path: file.path });
    try {
      const response = await fetch('/api/video-preparation?' + query.toString(), { headers: getAuthHeaders() });
      const data = await response.json();
      if (data.ready) {
        lightboxVideoUrl = getMediaUrl(file.path);
        lightboxVideoReady = true;
      } else {
        lightboxVideoProgressLabel = data.message || 'Preparing video...';
        lightboxVideoProgressValue = (data.progress || 0) + '%';
        lightboxVideoProgressWidth = (data.progress || 0) + '%';
        pollVideoPreparation(file);
      }
    } catch {}
  }

  async function pollVideoPreparation(file: any) {
    const query = new URLSearchParams({ path: file.path });
    while (true) {
      await new Promise(r => setTimeout(r, 400));
      const response = await fetch('/api/video-preparation?' + query.toString(), { headers: getAuthHeaders() });
      const data = await response.json();
      lightboxVideoProgressLabel = data.message || 'Preparing video...';
      lightboxVideoProgressValue = (data.progress || 0) + '%';
      lightboxVideoProgressWidth = (data.progress || 0) + '%';
      lightboxVideoErrorText = data.error || '';
      if (data.ready || data.error) {
        if (data.ready) { lightboxVideoUrl = getMediaUrl(file.path); lightboxVideoReady = true; }
        return;
      }
    }
  }

  async function openArchiveLightbox(file: any) {
    ui.lightboxIndex = -1;
    ui.lightboxPath = file.path;
    lightboxOpen = true;
    lightboxMode = 'zip';
    lightboxPathValue = file.path;
    lightboxTitleValue = file.name;
    lightboxMetaItems = [
      { key: 'extension', text: '.' + (file.extension || 'none'), badge: true },
      { key: 'size', text: formatBytes(file.size), badge: false },
    ];
    lightboxPrevDisabled = true;
    lightboxNextDisabled = true;
    lightboxZipLoading = true;
    lightboxZipErrorText = '';
    lightboxZipRootDirectories = [];
    lightboxZipFiles = [];
    lightboxZipBreadcrumbs = [{ label: '/', path: '' }];
    setBodyScrollLocked(true);

    try {
      const query = new URLSearchParams({ path: file.path });
      const response = await fetch('/api/archive-contents?' + query.toString(), { headers: getAuthHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Failed to read archive contents');
      archivePreviewDirectories = data.directories || [];
      archivePreviewFiles = data.files || [];
      setArchivePreviewDirectory('');
    } catch (error: any) {
      lightboxZipErrorText = error.message || 'Failed to read archive contents.';
    } finally {
      lightboxZipLoading = false;
    }
  }

  let archivePreviewFiles: any[] = $state([]);
  let archivePreviewDirectories: any[] = $state([]);
  let archivePreviewCurrentDirectory = $state('');

  function setArchivePreviewDirectory(relativePath: string) {
    archivePreviewCurrentDirectory = relativePath;
    lightboxZipCurrentDirectory = relativePath;
    lightboxZipRootDirectories = archivePreviewDirectories.filter((d: any) => d.parentPath === relativePath);
    lightboxZipFiles = archivePreviewFiles.filter((f: any) => f.parentPath === relativePath);
    const segments = relativePath ? relativePath.split('/') : [];
    const items: { label: string; path: string }[] = [{ label: '/', path: '' }];
    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? currentPath + '/' + segment : segment;
      items.push({ label: segment, path: currentPath });
    }
    lightboxZipBreadcrumbs = items;
  }

  function stepLightbox(direction: number) {
    if (lightboxMode === 'zip' || !ui.visibleMediaFiles.length) return;
    const nextIndex = ui.lightboxIndex + direction;
    if (nextIndex < 0 || nextIndex >= ui.visibleMediaFiles.length) return;
    ui.lightboxIndex = nextIndex;
    ui.lightboxPath = ui.visibleMediaFiles[nextIndex].path;
    syncLightboxState();
  }

  function getArchiveEntryDownloadUrl(file: any): string {
    const query = new URLSearchParams({ path: ui.lightboxPath, entry: file.path });
    const session = readSession();
    if (authEnabled && session?.token) query.set('token', session.token);
    return '/archive-entry-download?' + query.toString();
  }

  function setBodyScrollLocked(locked: boolean) {
    document.body.classList.toggle('overflow-hidden', locked);
  }

  function getLightboxImageMaxHeight(): number {
    if (typeof window === 'undefined') return 0;
    const headerApprox = 120;
    return Math.max(0, window.innerHeight - headerApprox - 48);
  }

  function getLightboxImageMaxWidth(): number {
    if (typeof window === 'undefined') return 0;
    return Math.max(0, window.innerWidth - 48);
  }

  function getFitHeightZoomPercent(): number {
    const currentFile = ui.visibleMediaFiles[ui.lightboxIndex] ?? null;
    const sourceHeight = ui.lightboxImageNaturalHeight || Number(currentFile?.height) || 0;
    if (!sourceHeight) return 100;
    const maxHeight = getLightboxImageMaxHeight();
    if (!maxHeight) return 100;
    return Math.max(1, Math.min(100, (maxHeight / sourceHeight) * 100));
  }

  function getFitZoomPercent(): number {
    const currentFile = ui.visibleMediaFiles[ui.lightboxIndex] ?? null;
    const sourceWidth = ui.lightboxImageNaturalWidth || Number(currentFile?.width) || 0;
    const sourceHeight = ui.lightboxImageNaturalHeight || Number(currentFile?.height) || 0;
    if (!sourceWidth || !sourceHeight) return getFitHeightZoomPercent();
    const maxHeight = getLightboxImageMaxHeight();
    const maxWidth = getLightboxImageMaxWidth();
    if (!maxHeight || !maxWidth) return 100;
    const scaleH = maxHeight / sourceHeight;
    const scaleW = maxWidth / sourceWidth;
    const scale = Math.min(scaleH, scaleW);
    return Math.max(1, Math.min(100, scale * 100));
  }

  function buildLightboxZoomOptions(fitZoomPercent: number): { value: string; label: string; sortValue: number }[] {
    const roundedFitZoomPercent = Math.round(fitZoomPercent);
    return [
      { value: LIGHTBOX_FIT_ZOOM_VALUE, label: roundedFitZoomPercent + '%', sortValue: fitZoomPercent },
      ...LIGHTBOX_ZOOM_LEVELS.map((level) => ({ value: String(level), label: level + '%', sortValue: level })),
    ].sort((left, right) => left.sortValue - right.sortValue);
  }

  function getCurrentLightboxZoomPercent(): number {
    if (lightboxZoomValue === LIGHTBOX_FIT_ZOOM_VALUE) return getFitZoomPercent();
    const parsed = Number(lightboxZoomValue);
    return Number.isFinite(parsed) ? parsed : 100;
  }

  function updateLightboxZoomOptionLabels() {
    const fitPercent = getFitZoomPercent();
    lightboxZoomOptions = buildLightboxZoomOptions(fitPercent);
    const current = lightboxZoomOptions.find((o) => o.value === lightboxZoomValue);
    lightboxZoomLabel = current?.label ?? 'Fit';
  }

  function updateLightboxZoomControls() {
    if (lightboxMode !== 'image') {
      lightboxZoomOutDisabled = true;
      lightboxZoomInDisabled = true;
      return;
    }
    const currentZoomPercent = getCurrentLightboxZoomPercent();
    const sorted = [...lightboxZoomOptions].sort((a, b) => a.sortValue - b.sortValue);
    lightboxZoomOutDisabled = false;
    lightboxZoomInDisabled = !sorted.some((o) => o.sortValue > currentZoomPercent);
  }

  function updateLightboxImageStyle() {
    if (lightboxMode !== 'image') {
      lightboxImageStyle = {};
      lightboxCanPan = false;
      return;
    }
    if (lightboxZoomValue === LIGHTBOX_FIT_ZOOM_VALUE) {
      lightboxImageStyle = {};
      lightboxCanPan = false;
      return;
    }
    const zoomPercent = Number(lightboxZoomValue);
    const zoomScale = Number.isFinite(zoomPercent) ? zoomPercent / 100 : 1;
    const naturalWidth = ui.lightboxImageNaturalWidth;
    const naturalHeight = ui.lightboxImageNaturalHeight;
    if (!naturalWidth || !naturalHeight) {
      lightboxImageStyle = {};
      lightboxCanPan = false;
      return;
    }
    lightboxImageStyle = {
      width: Math.max(1, Math.round(naturalWidth * zoomScale)) + 'px',
      height: Math.max(1, Math.round(naturalHeight * zoomScale)) + 'px',
      maxWidth: 'none',
      maxHeight: 'none',
    };
    syncLightboxPanAvailability();
  }

  function syncLightboxPanAvailability() {
    if (lightboxMode !== 'image') {
      lightboxCanPan = false;
      lightboxDragging = false;
      return;
    }
    window.requestAnimationFrame(() => {
      const backdrop = document.getElementById('lightboxBackdrop');
      if (!backdrop || lightboxMode !== 'image') {
        lightboxCanPan = false;
        lightboxDragging = false;
        return;
      }
      const canPan = backdrop.scrollWidth > backdrop.clientWidth || backdrop.scrollHeight > backdrop.clientHeight;
      lightboxCanPan = canPan;
      if (!canPan) {
        lightboxDragging = false;
        ui.lightboxPanPointerId = null;
      }
    });
  }

  function captureLightboxCenterAnchor(): { centerRatioX: number; centerRatioY: number } | null {
    const backdrop = document.getElementById('lightboxBackdrop');
    if (!backdrop) return null;
    const centerX = backdrop.scrollLeft + (backdrop.clientWidth / 2);
    const centerY = backdrop.scrollTop + (backdrop.clientHeight / 2);
    const scrollWidth = backdrop.scrollWidth;
    const scrollHeight = backdrop.scrollHeight;
    return {
      centerRatioX: scrollWidth > 0 ? centerX / scrollWidth : 0.5,
      centerRatioY: scrollHeight > 0 ? centerY / scrollHeight : 0.5,
    };
  }

  function restoreLightboxCenterAnchor(anchor: { centerRatioX: number; centerRatioY: number } | null) {
    if (!anchor) return;
    window.requestAnimationFrame(() => {
      const backdrop = document.getElementById('lightboxBackdrop');
      if (!backdrop) return;
      const nextCenterX = backdrop.scrollWidth * anchor.centerRatioX;
      const nextCenterY = backdrop.scrollHeight * anchor.centerRatioY;
      backdrop.scrollLeft = Math.max(0, nextCenterX - (backdrop.clientWidth / 2));
      backdrop.scrollTop = Math.max(0, nextCenterY - (backdrop.clientHeight / 2));
    });
  }

  function resetLightboxZoom() {
    lightboxZoomValue = LIGHTBOX_FIT_ZOOM_VALUE;
    lightboxZoomMenuOpen = false;
    updateLightboxZoomOptionLabels();
    updateLightboxZoomControls();
    updateLightboxImageStyle();
  }

  function setLightboxZoom(value: string) {
    const anchor = captureLightboxCenterAnchor();
    const nextValue = value || LIGHTBOX_FIT_ZOOM_VALUE;
    lightboxZoomValue = nextValue;
    lightboxZoomMenuOpen = false;
    updateLightboxZoomOptionLabels();
    updateLightboxZoomControls();
    updateLightboxImageStyle();
    restoreLightboxCenterAnchor(anchor);
  }

  function nudgeLightboxZoom(direction: number) {
    if (lightboxMode !== 'image') return;
    const currentZoomPercent = getCurrentLightboxZoomPercent();
    const sorted = [...lightboxZoomOptions].sort((a, b) => a.sortValue - b.sortValue);
    const presetOnly = sorted.filter((o) => o.value !== LIGHTBOX_FIT_ZOOM_VALUE);
    if (direction > 0) {
      const nextOption = sorted.find((o) => o.sortValue > currentZoomPercent);
      if (nextOption) setLightboxZoom(nextOption.value);
    } else {
      if (lightboxZoomValue === LIGHTBOX_FIT_ZOOM_VALUE && presetOnly.length) {
        setLightboxZoom(presetOnly[0].value);
      } else {
        const prevOption = [...presetOnly].reverse().find((o) => o.sortValue < currentZoomPercent);
        if (prevOption) setLightboxZoom(prevOption.value);
      }
    }
  }

  function handleLightboxImageLoad(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    ui.lightboxImageNaturalWidth = img.naturalWidth;
    ui.lightboxImageNaturalHeight = img.naturalHeight;
    updateLightboxZoomOptionLabels();
    updateLightboxZoomControls();
    updateLightboxImageStyle();
  }

  function startLightboxPan(event: PointerEvent) {
    if (!lightboxCanPan || event.button !== 0) return;
    const backdrop = document.getElementById('lightboxBackdrop');
    if (!backdrop) return;
    ui.lightboxPanPointerId = event.pointerId;
    ui.lightboxPanStartX = event.clientX;
    ui.lightboxPanStartY = event.clientY;
    ui.lightboxPanScrollLeft = backdrop.scrollLeft;
    ui.lightboxPanScrollTop = backdrop.scrollTop;
    ui.lightboxPanMoved = false;
    lightboxDragging = true;
    backdrop.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveLightboxPan(event: PointerEvent) {
    if (!lightboxDragging || ui.lightboxPanPointerId !== event.pointerId) return;
    const backdrop = document.getElementById('lightboxBackdrop');
    if (!backdrop) { endLightboxPan(event); return; }
    const deltaX = event.clientX - ui.lightboxPanStartX;
    const deltaY = event.clientY - ui.lightboxPanStartY;
    backdrop.scrollLeft = ui.lightboxPanScrollLeft - deltaX;
    backdrop.scrollTop = ui.lightboxPanScrollTop - deltaY;
    if (!ui.lightboxPanMoved && (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)) {
      ui.lightboxPanMoved = true;
    }
    event.preventDefault();
  }

  function endLightboxPan(event: PointerEvent) {
    if (ui.lightboxPanPointerId !== event.pointerId) return;
    const backdrop = document.getElementById('lightboxBackdrop');
    if (backdrop?.hasPointerCapture(event.pointerId)) {
      backdrop.releasePointerCapture(event.pointerId);
    }
    ui.lightboxPanPointerId = null;
    lightboxDragging = false;
    window.setTimeout(() => { ui.lightboxPanMoved = false; }, 0);
  }

  function handleLightboxBackdropClick(event: MouseEvent) {
    if (ui.lightboxPanMoved) { event.preventDefault(); return; }
    closeLightbox();
  }

  $effect(() => {
    if (typeof window !== 'undefined') {
      const existingSession = readSession();
      if (!authEnabled || existingSession) {
        showApp();
        initializeApp();
      } else {
        showLogin();
      }
    }
  });

  $effect(() => {
    fileInputOpenToken;
    if (fileInputRef && fileInputOpenToken !== fileInputLastHandled) {
      fileInputLastHandled = fileInputOpenToken;
      fileInputRef.value = '';
      fileInputRef.click();
    }
  });

  $effect(() => {
    if (!pageSizeMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (pageSizeContainerRef && !pageSizeContainerRef.contains(e.target as Node)) {
        pageSizeMenuOpen = false;
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  });

</script>

<svelte:window onkeydown={handleKeydown} />

{#if showLoginShell}
  <Login
    bind:username={loginUsername}
    bind:password={loginPassword}
    bind:rememberMe
    bind:passwordVisible
    bind:loginStatusText
    bind:loginPending
      sessionExpiryLabel={sessionExpiryLabel}
    onLogin={handleLogin}
  />
{/if}

{#if showAppShell}
  <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">File Manager</h1>
        <p class="mt-2 text-sm text-slate-400">Browse files as a paginated tree, upload new files, and bundle selected files into a zip archive.</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <div class="rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300">{sessionInfoText}</div>
        <div class="rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300">{summaryText}</div>
        {#if authEnabled}
          <button onclick={handleLogout} type="button" aria-label="Log out" class="group relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-100 transition hover:border-rose-500 hover:text-rose-200">
            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.75 4.5A2.25 2.25 0 0 1 6 2.25h4a.75.75 0 0 1 0 1.5H6A.75.75 0 0 0 5.25 4.5v11A.75.75 0 0 0 6 16.25h4a.75.75 0 0 1 0 1.5H6a2.25 2.25 0 0 1-2.25-2.25v-11Zm8.22 2.72a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 1 1-1.06-1.06l1.97-1.97H8.75a.75.75 0 0 1 0-1.5h5.19l-1.97-1.97a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" /></svg>
            <span class="pointer-events-none absolute -bottom-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition group-hover:opacity-100">Log out</span>
          </button>
        {/if}
      </div>
    </div>

    <section class="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/40">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-wrap items-center gap-2">
          {#each breadcrumbs as item, index}
            <div class="flex items-center gap-2">
              <button type="button" class="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-cyan-500 hover:text-cyan-300" onclick={() => navigateToDirectory(item.path)}>{item.label}</button>
              {#if index < breadcrumbs.length - 1}<span class="text-slate-600">/</span>{/if}
            </div>
          {/each}
        </div>
        <div class="flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <div class="inline-flex rounded-xl border border-slate-700 bg-slate-950 p-1">
            <button onclick={() => setViewMode('list')} type="button" aria-label="List view" title="List view"
              class="rounded-lg px-3 py-1.5 font-semibold {viewMode === 'list' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 transition hover:text-cyan-300'}">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M3.75 4.5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75Zm5-10a.75.75 0 0 1 .75-.75h6.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h6.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h6.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Z" />
              </svg>
            </button>
            <button onclick={() => setViewMode('grid')} type="button" aria-label="Grid view" title="Grid view"
              class="rounded-lg px-3 py-1.5 font-semibold {viewMode === 'grid' ? 'bg-cyan-500 text-slate-950' : 'text-slate-300 transition hover:text-cyan-300'}">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M3.75 3.75A1.75 1.75 0 0 1 5.5 2h3A1.75 1.75 0 0 1 10.25 3.75v3A1.75 1.75 0 0 1 8.5 8.5h-3A1.75 1.75 0 0 1 3.75 6.75v-3Zm0 9.5A1.75 1.75 0 0 1 5.5 11.5h3a1.75 1.75 0 0 1 1.75 1.75v3A1.75 1.75 0 0 1 8.5 18h-3a1.75 1.75 0 0 1-1.75-1.75v-3ZM11.5 3.75A1.75 1.75 0 0 1 13.25 2h3A1.75 1.75 0 0 1 18 3.75v3A1.75 1.75 0 0 1 16.25 8.5h-3a1.75 1.75 0 0 1-1.75-1.75v-3Zm0 9.5a1.75 1.75 0 0 1 1.75-1.75h3A1.75 1.75 0 0 1 18 13.25v3A1.75 1.75 0 0 1 16.25 18h-3a1.75 1.75 0 0 1-1.75-1.75v-3Z" />
              </svg>
            </button>
          </div>
          <span>{selectedCountText}</span>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        {#each availableExtensions as extension}
          <button type="button" class="rounded-full border px-3 py-1 text-xs font-semibold {selectedExtensionsList.includes(extension) ? 'border-cyan-400 bg-cyan-400/10 text-cyan-300' : 'border-slate-700 bg-slate-950 text-slate-300 transition hover:border-cyan-500 hover:text-cyan-300'}" onclick={() => toggleExtensionSelection(extension)}>.{extension}</button>
        {/each}
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="mt-4 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition {dropzoneActive ? 'border-cyan-500 bg-cyan-500/5' : 'border-slate-700 bg-slate-950/60 hover:border-cyan-500 hover:bg-cyan-500/5'}"
        ondragenter={(e) => { e.preventDefault(); dropzoneActive = true; }}
        ondragover={(e) => { e.preventDefault(); dropzoneActive = true; }}
        ondragleave={(e) => { e.preventDefault(); dropzoneActive = false; }}
        ondrop={(e) => { e.preventDefault(); dropzoneActive = false; uploadFiles(e.dataTransfer?.files ?? null); }}
      >
        <p class="text-lg font-medium text-slate-100">Drop files here or use the upload button</p>
        <p class="mt-2 text-sm text-slate-400">Uploaded files are written to the <code class="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">{uploadDir}</code> directory.</p>
        <div class="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button aria-label="Upload files" onclick={() => { if (!uploadBusy) fileInputOpenToken += 1; }} disabled={uploadBusy} type="button" class="group relative inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500 text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40">
            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 2.75a.75.75 0 0 1 .75.75v7.19l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L6.22 9.78a.75.75 0 0 1 1.06-1.06l1.97 1.97V3.5A.75.75 0 0 1 10 2.75ZM4.5 13.25A.75.75 0 0 1 5.25 14v1.5c0 .414.336.75.75.75h8a.75.75 0 0 0 .75-.75V14a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 14 17.75H6A2.25 2.25 0 0 1 3.75 15.5V14a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" /></svg>
            <span class="pointer-events-none absolute -bottom-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition group-hover:opacity-100">Upload files</span>
          </button>
          <button aria-label="Download selected as zip" onclick={createSelectionZip} disabled={!hasSelection || zipPending} type="button" class="group relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M7 2.75A1.75 1.75 0 0 0 5.25 4.5v11A1.75 1.75 0 0 0 7 17.25h6A1.75 1.75 0 0 0 14.75 15.5v-7a.75.75 0 0 0-.22-.53l-3-3A.75.75 0 0 0 11 4.75H7Z" /></svg>
            <span class="pointer-events-none absolute -bottom-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition group-hover:opacity-100">Download selected as zip</span>
          </button>
          <button aria-label="Delete selected files" onclick={deleteSelectedFiles} disabled={!hasSelection || deletePending} type="button" class="group relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-900 bg-rose-950/40 text-rose-200 transition hover:border-rose-500 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-40">
            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.75 2.75a1.75 1.75 0 0 0-1.67 1.23L6.89 4.5H4.5a.75.75 0 0 0 0 1.5h.44l.83 9.12A2.25 2.25 0 0 0 8.01 17.25h3.98a2.25 2.25 0 0 0 2.24-2.13l.83-9.12h.44a.75.75 0 0 0 0-1.5h-2.39l-.19-.52a1.75 1.75 0 0 0-1.67-1.23h-2.5Z" clip-rule="evenodd" /></svg>
            <span class="pointer-events-none absolute -bottom-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition group-hover:opacity-100">Delete selected files</span>
          </button>
        </div>
        {#key fileInputVersion}
          <input bind:this={fileInputRef} type="file" multiple class="hidden" onchange={(e) => uploadFiles(e.currentTarget.files)} />
        {/key}
        {#if uploadProgressVisible}
          <div class="mx-auto mt-5 max-w-md text-left">
            <div class="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300">
              <span>{uploadProgressLabel}</span>
              <span>{uploadProgressValue}</span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-slate-800">
              <div style="width: {uploadProgressWidth}" class="h-full w-0 rounded-full bg-cyan-500 transition-[width] duration-150"></div>
            </div>
          </div>
        {/if}
      </div>

      <div class="mt-4 text-sm text-slate-400">{statusText}</div>

      <div class="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
        {#if directories.length === 0 && files.length === 0}
          <div>No items in this directory.</div>
        {/if}

        {#if viewMode === 'list' && (directories.length || files.length)}
          <div class="space-y-3">
            {#each directories as directory (directory.path)}
              <div class="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 transition hover:border-cyan-500 hover:bg-slate-900">
                <input class="size-4 rounded border-slate-600 bg-slate-950 text-cyan-400" type="checkbox" checked={ui.selectedFiles.has(directory.path)} onchange={(e) => setFileSelection(directory.path, e.currentTarget.checked)} />
                <button type="button" class="flex min-w-0 flex-1 items-center justify-between text-left" onclick={() => navigateToDirectory(directory.path)}>
                  <span class="min-w-0 truncate font-semibold text-cyan-300">{directory.name}/</span>
                  <span class="text-xs text-slate-500">Folder</span>
                </button>
              </div>
            {/each}

            {#each files as file (file.path)}
              <label class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/30 px-4 py-3 hover:bg-slate-900/60">
                <input class="size-4 rounded border-slate-600 bg-slate-950 text-cyan-400" type="checkbox" checked={ui.selectedFiles.has(file.path)} onchange={(e) => setFileSelection(file.path, e.currentTarget.checked)} />
                {#if isZipFile(file.extension)}
                  <button type="button" class="min-w-0 flex-1 truncate text-left text-slate-100 underline-offset-4 transition hover:text-cyan-300 hover:underline" onclick={(e) => { e.preventDefault(); e.stopPropagation(); openLightbox(file.path); }}>{file.name}</button>
                {:else}
                  <a class="min-w-0 flex-1 truncate text-slate-100 underline-offset-4 hover:text-cyan-300 hover:underline" href={getDownloadUrl(file.path)}>{file.name}</a>
                {/if}
                <span class="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400">.{file.extension || 'none'}</span>
                <span class="text-xs text-slate-400">{formatBytes(file.size)}</span>
                <span class="text-xs text-slate-500">{formatDateTime(file.modifiedAt)}</span>
              </label>
            {/each}
          </div>
        {/if}

        {#if viewMode === 'grid' && (directories.length || files.length)}
          <div class="space-y-6">
            {#if directories.length}
              <div>
                <p class="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Folders</p>
                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {#each directories as directory (directory.path)}
          <div class="relative" bind:this={pageSizeContainerRef}>
                      <input class="absolute left-3 top-3 z-10 size-4 rounded border-slate-600 bg-slate-950 text-cyan-400" type="checkbox" checked={ui.selectedFiles.has(directory.path)} onchange={(e) => setFileSelection(directory.path, e.currentTarget.checked)} />
                      <button type="button" class="flex min-h-28 w-full flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-4 pl-10 text-left transition hover:border-cyan-500 hover:bg-slate-900" onclick={() => navigateToDirectory(directory.path)}>
                        <span class="text-3xl">&#128193;</span>
                        <div>
                          <p class="truncate font-semibold text-cyan-300">{directory.name}</p>
                          <p class="mt-1 text-xs text-slate-500">Open folder</p>
                        </div>
                      </button>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if files.length}
              <div>
                <p class="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Files</p>
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {#each files as file (file.path)}
                    <label class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 transition hover:border-cyan-500 hover:bg-slate-900/70">
                      <div class="group relative">
                        <div class="aspect-[4/3] bg-slate-950">
                          {#if isImageFile(file.extension)}
                            <img class="h-full w-full object-cover" src={thumbnailSupportedExtensions.includes(file.extension) ? getThumbnailUrl(file.path) : getMediaUrl(file.path)} alt={file.name} loading="lazy" />
                          {:else if isVideoFile(file.extension)}
                            <div class="flex h-full items-center justify-center text-4xl text-slate-500">&#127916;</div>
                          {:else}
                            <div class="flex h-full items-center justify-center text-4xl text-slate-500">.{file.extension || 'file'}</div>
                          {/if}
                        </div>
                        {#if isImageFile(file.extension)}
                          <button type="button" aria-label="Open media viewer" class="absolute right-3 top-3 hidden h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-950/85 text-slate-100 shadow-lg transition hover:border-cyan-500 hover:text-cyan-300 group-hover:flex" onclick={(e) => { e.preventDefault(); e.stopPropagation(); openLightbox(file.path); }}>
                            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.25 3.5a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75V7a.75.75 0 0 1-1.5 0V5.31l-4.22 4.22a.75.75 0 1 1-1.06-1.06l4.22-4.22H13a.75.75 0 0 1-.75-.75Zm-4.5 13a.75.75 0 0 1-.75.75H3.5a.75.75 0 0 1-.75-.75V13a.75.75 0 0 1 1.5 0v1.69l4.22-4.22a.75.75 0 0 1 1.06 1.06l-4.22 4.22H7a.75.75 0 0 1 .75.75Zm8.75-3.5a.75.75 0 0 1 .75.75v2.75a.75.75 0 0 1-.75.75h-2.75a.75.75 0 0 1 0-1.5h1.69l-4.22-4.22a.75.75 0 0 1 1.06-1.06l4.22 4.22V13.75a.75.75 0 0 1 .75-.75Zm-13-9.5a.75.75 0 0 1 .75-.75H7a.75.75 0 0 1 0 1.5H5.31l4.22 4.22a.75.75 0 1 1-1.06 1.06L4.25 5.31V7a.75.75 0 0 1-1.5 0V3.5Z" clip-rule="evenodd" /></svg>
                          </button>
                        {/if}
                        {#if isZipFile(file.extension)}
                          <button type="button" aria-label="Open archive viewer" class="absolute right-3 top-3 hidden h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-950/85 text-slate-100 shadow-lg transition hover:border-cyan-500 hover:text-cyan-300 group-hover:flex" onclick={(e) => { e.preventDefault(); e.stopPropagation(); openLightbox(file.path); }}>
                            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.5 2.75A1.75 1.75 0 0 0 3.75 4.5v11c0 .966.784 1.75 1.75 1.75h9A1.75 1.75 0 0 0 16.25 15.5v-7a.75.75 0 0 0-.22-.53l-3-3a.75.75 0 0 0-.53-.22h-7Z" clip-rule="evenodd" /></svg>
                          </button>
                        {/if}
                        <input class="absolute left-3 top-3 size-4 rounded border-slate-600 bg-slate-950 text-cyan-400" type="checkbox" checked={ui.selectedFiles.has(file.path)} onchange={(e) => setFileSelection(file.path, e.currentTarget.checked)} />
                      </div>
                      <div class="space-y-2 p-4">
                        {#if isZipFile(file.extension)}
                          <button type="button" class="block w-full truncate text-left font-semibold text-slate-100 underline-offset-4 transition hover:text-cyan-300 hover:underline" onclick={(e) => { e.preventDefault(); e.stopPropagation(); openLightbox(file.path); }}>{file.name}</button>
                        {:else}
                          <a class="block truncate font-semibold text-slate-100 underline-offset-4 hover:text-cyan-300 hover:underline" href={getDownloadUrl(file.path)}>{file.name}</a>
                        {/if}
                        <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span class="rounded-full border border-slate-700 px-2 py-1">.{file.extension || 'none'}</span>
                          <span>{formatBytes(file.size)}</span>
                          {#if isImageFile(file.extension) && formatImageDimensions(file)}<span>{formatImageDimensions(file)}</span>{/if}
                          <span>{formatDateTime(file.modifiedAt)}</span>
                        </div>
                      </div>
                    </label>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-400">
        <button aria-label="Previous page" onclick={() => changePageBy(-1)} disabled={!canGoPrev} type="button" class="group relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 font-semibold text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
          <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.78 4.22a.75.75 0 0 1 0 1.06L7.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06l-5.25-5.25a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" clip-rule="evenodd" /></svg>
          <span class="pointer-events-none absolute -bottom-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition group-hover:opacity-100">Previous page</span>
        </button>
        <span>Page</span>
        <input bind:value={pageInputValue} max={pageInputMax} onchange={() => { ui.page = Math.min(ui.totalPages, Math.max(1, Number(pageInputValue || '1'))); loadFiles(); }} onkeydown={(e) => { if (e.key === 'Enter') { ui.page = Math.min(ui.totalPages, Math.max(1, Number(pageInputValue || '1'))); loadFiles(); } }} type="number" min="1" class="w-20 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-0" />
        <span>of</span>
        <span class="text-slate-400">{pageInfoText}</span>
        <button aria-label="Next page" onclick={() => changePageBy(1)} disabled={!canGoNext} type="button" class="group relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 font-semibold text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
          <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.22 15.78a.75.75 0 0 1 0-1.06L12.94 10 8.22 5.28a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 0 1-1.06 0Z" clip-rule="evenodd" /></svg>
          <span class="pointer-events-none absolute -bottom-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition group-hover:opacity-100">Next page</span>
        </button>
        <div class="flex items-center gap-2">
          <span>Page size</span>
          <div class="relative">
            <button onclick={() => pageSizeMenuOpen = !pageSizeMenuOpen} type="button" class="inline-flex min-w-24 items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition hover:border-cyan-500">
              <span>{pageSizeDisplay}</span>
              <svg class="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" /></svg>
            </button>
            {#if pageSizeMenuOpen}
              <div class="absolute right-0 z-20 mt-2 w-32 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur">
                {#each pageSizeOptions as option}
                  <button onclick={() => { pageSizeDisplay = String(option); ui.pageSize = option === 'All' ? 'All' : Number(option); ui.page = 1; pageSizeMenuOpen = false; loadFiles(); }} type="button" class="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition {String(option) === pageSizeDisplay ? 'bg-cyan-500/15 text-cyan-200' : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200'}">
                    <span>{String(option)}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </section>
  </main>
{/if}

{#if lightboxOpen}
  <Lightbox
    bind:open={lightboxOpen}
    mode={lightboxMode}
    pathValue={lightboxPathValue}
    imageUrl={lightboxImageUrl}
    videoUrl={lightboxVideoUrl}
    videoReady={lightboxVideoReady}
    videoProgressLabel={lightboxVideoProgressLabel}
    videoProgressValue={lightboxVideoProgressValue}
    videoProgressWidth={lightboxVideoProgressWidth}
    videoErrorText={lightboxVideoErrorText}
    zipRootDirectories={lightboxZipRootDirectories}
    zipFiles={lightboxZipFiles}
    zipCurrentDirectory={lightboxZipCurrentDirectory}
    zipBreadcrumbs={lightboxZipBreadcrumbs}
    zipLoading={lightboxZipLoading}
    zipErrorText={lightboxZipErrorText}
    imageAlt={lightboxImageAlt}
    titleValue={lightboxTitleValue}
    metaItems={lightboxMetaItems}
    prevDisabled={lightboxPrevDisabled}
    nextDisabled={lightboxNextDisabled}
    zoomValue={lightboxZoomValue}
    zoomMenuOpen={lightboxZoomMenuOpen}
    zoomInDisabled={lightboxZoomInDisabled}
    zoomOutDisabled={lightboxZoomOutDisabled}
    canPan={lightboxCanPan}
    dragging={lightboxDragging}
    imageStyle={lightboxImageStyle}
    zoomOptions={lightboxZoomOptions}
    zoomLabel={lightboxZoomLabel}
    onClose={closeLightbox}
    onPrev={() => stepLightbox(-1)}
    onNext={() => stepLightbox(1)}
    onNavigateArchiveDirectory={setArchivePreviewDirectory}
    getArchiveEntryDownloadUrl={getArchiveEntryDownloadUrl}
    onImageLoad={handleLightboxImageLoad}
    onZoomIn={() => nudgeLightboxZoom(1)}
    onZoomOut={() => nudgeLightboxZoom(-1)}
    onZoomChange={(v) => setLightboxZoom(v)}
    onToggleZoomMenu={() => { lightboxZoomMenuOpen = !lightboxZoomMenuOpen; }}
    onPointerDown={startLightboxPan}
    onPointerMove={moveLightboxPan}
    onPointerUp={endLightboxPan}
    onBackdropClick={handleLightboxBackdropClick}
  />
{/if}

{#if confirmDialogOpen}
  <ConfirmDialog
    title={confirmDialogTitleText}
    message={confirmDialogMessageText}
    confirmLabel={confirmDialogConfirmLabel}
    onConfirm={() => closeConfirmDialog(true)}
    onCancel={() => closeConfirmDialog(false)}
  />
{/if}

{#if uploadConflictDialogOpen}
  <UploadConflictDialog
    title={uploadConflictDialogTitleText}
    message={uploadConflictDialogMessageText}
    bind:fileName={uploadConflictFileName}
    errorText={uploadConflictDialogErrorText}
    onRename={() => {
      if (!uploadConflictFileName.trim()) { uploadConflictDialogErrorText = 'Filename is required.'; return; }
      closeUploadConflictDialog({ action: 'rename', fileName: uploadConflictFileName });
    }}
    onOverwrite={() => closeUploadConflictDialog({ action: 'overwrite' })}
    onCancel={() => closeUploadConflictDialog({ action: 'cancel' })}
  />
{/if}
