<script lang="ts">
  import Login from "./Login.svelte";
  import Lightbox from "./Lightbox.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import CreateFolderDialog from "./CreateFolderDialog.svelte";
  import CompressDialog from "./CompressDialog.svelte";
  import UploadConflictDialog from "./UploadConflictDialog.svelte";

  interface Props {
    auth: { enabled: boolean; sessionExpiryMs: number; username: string };
    uploadDir: string;
    maxZipSize: number;
    imageExtensions: string[];
    videoExtensions: string[];
    thumbnailSupportedExtensions: string[];
  }

  interface VideoPreparationEntry {
    ready: boolean;
    progress: number;
    message: string;
    error: string;
    requiresConversion?: boolean;
  }

  interface SharedVideoPlaybackEntry {
    currentTime: number;
    shouldResume: boolean;
    preferredSurface: "grid" | "lightbox";
  }

  interface UploadCandidate {
    file: File;
    relativePath: string;
  }

  interface FileSystemEntryLike {
    isFile: boolean;
    isDirectory: boolean;
    fullPath?: string;
    name: string;
  }

  interface FileSystemFileEntryLike extends FileSystemEntryLike {
    file: (
      successCallback: (file: File) => void,
      errorCallback?: (error: DOMException) => void,
    ) => void;
  }

  interface FileSystemDirectoryReaderLike {
    readEntries: (
      successCallback: (entries: FileSystemEntryLike[]) => void,
      errorCallback?: (error: DOMException) => void,
    ) => void;
  }

  interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
    createReader: () => FileSystemDirectoryReaderLike;
  }

  type DataTransferItemWithEntry = DataTransferItem & {
    webkitGetAsEntry?: () => FileSystemEntry | null;
  };

  let {
    auth,
    uploadDir,
    maxZipSize,
    imageExtensions,
    videoExtensions,
    thumbnailSupportedExtensions,
  }: Props = $props();

  const SESSION_STORAGE_KEY = "file-manager-auth";
  const LIGHTBOX_FIT_ZOOM_VALUE = "fit";
  const LIGHTBOX_ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300];

  const authEnabled = $derived(auth.enabled);
  const authUsername = $derived(auth.username);
  const sessionExpiryMs = $derived(auth.sessionExpiryMs);

  // svelte-ignore state_referenced_locally
  let showLoginShell = $state(authEnabled);
  // svelte-ignore state_referenced_locally
  let showAppShell = $state(!authEnabled);
  let loginPending = $state(false);
  // svelte-ignore state_referenced_locally
  let loginUsername = $state(authUsername);
  let loginPassword = $state("");
  let rememberMe = $state(false);
  let passwordVisible = $state(false);
  let loginStatusText = $state("");
  // svelte-ignore state_referenced_locally
  let sessionInfoText = $state(authEnabled ? "" : "Authentication disabled");
  let summaryFolderText = $state("");
  let summaryFileText = $state("");
  let totalSizeText = $state("");
  let summaryText = $derived(
    [summaryFolderText, summaryFileText, totalSizeText]
      .filter((t) => t)
      .join(" | "),
  );
  let selectedCountText = $state("0 selected");
  let statusText = $state("");
  let loading = $state(false);
  let pageInfoText = $state("");
  let pageInputValue = $state("1");
  let pageInputMax = $state("1");
  let totalItems = $state(0);
  let pageSizeOptions: (number | string)[] = $state([]);
  let showPagination = $derived(totalItems >= (Math.min(...pageSizeOptions.filter((n): n is number => typeof n === 'number')) || 10));
  let pageSizeMenuOpen = $state(false);
  let pageSizeMenuLeft = $state(false);
  let pageSizeDisplay = $state("20");
  let viewMode = $state<"list" | "grid">("grid");
  let breadcrumbs: { label: string; path: string }[] = $state([
    { label: "/", path: "" },
  ]);
  let availableExtensions: string[] = $state([]);
  let selectedExtensionsList: string[] = $state([]);
  let nameFilter = $state("");
  let directories: { name: string; path: string }[] = $state([]);
  let files: any[] = $state([]);
  const directoriesAllSelected = $derived(
    directories.length > 0 &&
      directories.every((d) => ui.selectedFiles.has(d.path)),
  );
  const directoriesSomeSelected = $derived(
    !directoriesAllSelected &&
      directories.some((d) => ui.selectedFiles.has(d.path)),
  );
  const filesAllSelected = $derived(
    files.length > 0 && files.every((f) => ui.selectedFiles.has(f.path)),
  );
  const filesSomeSelected = $derived(
    !filesAllSelected && files.some((f) => ui.selectedFiles.has(f.path)),
  );
  let selectedFilePaths: string[] = $state([]);
  let hasSelection = $state(false);
  let zipPending = $state(false);
  let deletePending = $state(false);
  let createFolderPending = $state(false);
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
  let foldersHeaderCheckboxRef = $state<HTMLInputElement | null>(null);
  let filesHeaderCheckboxRef = $state<HTMLInputElement | null>(null);
  let uploadProgressLabel = $state("Uploading...");
  let uploadProgressValue = $state("0%");
  let uploadProgressWidth = $state("0%");
  let videoPreparationByPath = $state<Record<string, VideoPreparationEntry>>(
    {},
  );
  let activeVideoPreparationPolls = new Set<string>();
  const sharedVideoPlaybackByPath = new Map<string, SharedVideoPlaybackEntry>();
  let sharedVideoSyncDepth = 0;

  let confirmDialogOpen = $state(false);
  let confirmDialogTitleText = $state("Delete selected files?");
  let confirmDialogMessageText = $state("This action cannot be undone.");
  let confirmDialogConfirmLabel = $state("Delete");

  let uploadConflictDialogOpen = $state(false);
  let uploadConflictDialogTitleText = $state("File already exists");
  let uploadConflictDialogMessageText = $state(
    "Choose whether to overwrite the existing file or upload with a different name.",
  );
  let uploadConflictFileName = $state("");
  let uploadConflictDialogErrorText = $state("");

  let createFolderDialogOpen = $state(false);
  let createFolderDialogTitleText = $state("Create folder");
  let createFolderDialogMessageText = $state(
    "Create a new folder in the current upload directory.",
  );
  let createFolderDialogName = $state("");
  let createFolderDialogErrorText = $state("");

  let compressDialogOpen = $state(false);
  let compressDialogFileName = $state("download.zip");
  let compressDialogErrorText = $state("");
  let compressDialogTotalSize = $state(0);
  let compressDialogResizeWidth = $state(0);
  let compressDialogResizeHeight = $state(0);
  let compressDialogResizeQuality = $state(100);
  let compressDialogImageFormat = $state("jpeg");
  let compressDialogProgress = $state<number | null>(null);

  let lightboxOpen = $state(false);
  let lightboxMode = $state("");
  let lightboxPathValue = $state("");
  let lightboxImageUrl = $state("");
  let lightboxVideoUrl = $state("");
  let lightboxVideoReady = $state(false);
  let lightboxVideoProgressLabel = $state(
    "Preparing video for browser playback...",
  );
  let lightboxVideoProgressValue = $state("0%");
  let lightboxVideoProgressWidth = $state("0%");
  let lightboxVideoErrorText = $state("");
  let lightboxZipRootDirectories: {
    name: string;
    path: string;
    parentPath: string;
    modifiedAt: string;
  }[] = $state([]);
  let lightboxZipFiles: any[] = $state([]);
  let lightboxZipCurrentDirectory = $state("");
  let lightboxZipBreadcrumbs: { label: string; path: string }[] = $state([
    { label: "/", path: "" },
  ]);
  let lightboxZipLoading = $state(false);
  let lightboxZipErrorText = $state("");
  let lightboxImageAlt = $state("");
  let lightboxTitleValue = $state("");
  let lightboxMetaItems: { key: string; text: string; badge: boolean }[] =
    $state([]);
  let lightboxPrevDisabled = $state(false);
  let lightboxNextDisabled = $state(false);
  let lightboxZoomValue = $state("fit");
  let lightboxZoomMenuOpen = $state(false);
  let lightboxZoomInDisabled = $state(false);
  let lightboxZoomOutDisabled = $state(true);
  let lightboxCanPan = $state(false);
  let lightboxDragging = $state(false);
  let lightboxImageStyle: Record<string, string> = $state({});
  let lightboxZoomOptions: {
    value: string;
    label: string;
    sortValue: number;
  }[] = $state([]);
  let lightboxZoomLabel = $state("Fit");

  const ui = $state({
    page: 1,
    pageSize: 20 as number | string,
    totalPages: 1,
    currentDir: "",
    selectedFiles: new Set<string>(),
    requestedExtensions: new Set<string>(),
    selectedExtensions: new Set<string>(),
    visibleMediaFiles: [] as any[],
    totalMedia: 0,
    mediaOffset: 0,
    lightboxIndex: -1,
    lightboxPath: "",
    lightboxLoadToken: 0,
    isUploading: false,
    lightboxImageNaturalWidth: 0,
    lightboxImageNaturalHeight: 0,
    pendingLightboxDirection: 0,
    confirmDialogResolver: null as ((result: boolean) => void) | null,
    uploadConflictDialogResolver: null as ((result: any) => void) | null,
    lightboxPanPointerId: null as number | null,
    lightboxPanStartX: 0,
    lightboxPanStartY: 0,
    lightboxPanScrollLeft: 0,
    lightboxPanScrollTop: 0,
    lightboxPanMoved: false,
    lightboxPinchActive: false,
    lightboxPinchStartDist: 0,
    lightboxPinchStartZoomPercent: 0,
    lightboxPinchMidX: 0,
    lightboxPinchMidY: 0,
    lightboxPinchLastPercent: 0,
    lightboxPinchFitPercent: 0,
  });

  const selectedTotalSize = $derived(
    [...ui.selectedFiles].reduce((sum, path) => {
      const f = files.find((f: any) => f.path === path);
      return sum + (f?.size ?? 0);
    }, 0),
  );
  const zipSizeExceeded = $derived(selectedTotalSize > maxZipSize);
  const commonImageInfo = $derived.by(() => {
    const imageFiles = [...ui.selectedFiles]
      .map((path) => files.find((f: any) => f.path === path))
      .filter((f): f is any => f && isImageFile(f.extension));
    if (imageFiles.length === 0) return null;
    const firstW = Number(imageFiles[0].width);
    const firstH = Number(imageFiles[0].height);
    if (!Number.isFinite(firstW) || !Number.isFinite(firstH) || firstW <= 0 || firstH <= 0) return null;
    const allSame = imageFiles.every(
      (f) => Number(f.width) === firstW && Number(f.height) === firstH,
    );
    if (!allSame) return null;
    return { width: firstW, height: firstH };
  });
  const commonImageExtension = $derived.by(() => {
    const imageExts = [...ui.selectedFiles]
      .map((path) => files.find((f: any) => f.path === path))
      .filter((f): f is any => f && isImageFile(f.extension))
      .map((f) => f.extension.toLowerCase());
    if (imageExts.length === 0) return null;
    const first = imageExts[0];
    return imageExts.every((e) => e === first) ? first : null;
  });
  const selectedDirCount = $derived(
    [...ui.selectedFiles].filter((path) =>
      directories.some((d) => d.path === path),
    ).length,
  );
  const selectedFileCount = $derived(
    [...ui.selectedFiles].filter((path) =>
      files.some((f: any) => f.path === path),
    ).length,
  );

  function isWithinConfiguredUploadDir(
    currentDir: string,
    configuredUploadDir: string,
  ): boolean {
    const normalizedCurrentDir = normalizeClientRelativeDirectory(currentDir);
    const normalizedUploadDir =
      normalizeClientRelativeDirectory(configuredUploadDir);

    if (!normalizedUploadDir) {
      return true;
    }

    const currentSegments = normalizedCurrentDir
      ? normalizedCurrentDir.split("/")
      : [];
    const uploadSegments = normalizedUploadDir.split("/");

    for (
      let start = 0;
      start <= currentSegments.length - uploadSegments.length;
      start += 1
    ) {
      const matchesUploadDir = uploadSegments.every(
        (segment, index) => currentSegments[start + index] === segment,
      );

      if (matchesUploadDir) {
        return true;
      }
    }

    return false;
  }

  const inUploadDir = $derived(
    isWithinConfiguredUploadDir(ui.currentDir, uploadDir),
  );

  function normalizeClientRelativeDirectory(relativeDir: string): string {
    const parts = String(relativeDir || "").split("/");
    const normalizedParts: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") throw new Error("Invalid directory path");
      normalizedParts.push(part);
    }
    return normalizedParts.join("/");
  }

  function normalizeUploadCandidatePath(relativePath: string): string {
    return normalizeClientRelativeDirectory(
      String(relativePath || "").replaceAll("\\", "/"),
    );
  }

  function createUploadCandidatesFromFileList(
    fileList: FileList | null,
  ): UploadCandidate[] {
    if (!fileList?.length) {
      return [];
    }

    return Array.from(fileList)
      .map((file) => {
        const relativePath = normalizeUploadCandidatePath(
          file.webkitRelativePath || file.name,
        );
        return relativePath ? { file, relativePath } : null;
      })
      .filter((entry): entry is UploadCandidate => !!entry);
  }

  function readFileEntry(entry: FileSystemFileEntryLike): Promise<File> {
    return new Promise((resolve, reject) => {
      entry.file(resolve, reject);
    });
  }

  function readDirectoryEntries(
    reader: FileSystemDirectoryReaderLike,
  ): Promise<FileSystemEntryLike[]> {
    return new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
  }

  async function collectEntryUploadCandidates(
    entry: FileSystemEntryLike,
  ): Promise<UploadCandidate[]> {
    if (entry.isFile) {
      const file = await readFileEntry(entry as FileSystemFileEntryLike);
      const relativePath = normalizeUploadCandidatePath(
        entry.fullPath?.replace(/^\/+/, "") || file.name,
      );
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

  async function getDropUploadCandidates(
    dataTransfer: DataTransfer | null,
  ): Promise<UploadCandidate[]> {
    if (!dataTransfer) {
      return [];
    }

    const items = Array.from(
      dataTransfer.items || [],
    ) as DataTransferItemWithEntry[];
    const entries = items
      .filter((item) => item.kind === "file")
      .map((item) => item.webkitGetAsEntry?.() ?? null)
      .filter((entry): entry is FileSystemEntry => !!entry);

    if (entries.length === 0) {
      return createUploadCandidatesFromFileList(dataTransfer.files);
    }

    const candidates = await Promise.all(
      entries.map((entry) =>
        collectEntryUploadCandidates(entry as unknown as FileSystemEntryLike),
      ),
    );
    return candidates.flat();
  }

  function normalizeLightboxZoomValue(value: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed === LIGHTBOX_FIT_ZOOM_VALUE) return LIGHTBOX_FIT_ZOOM_VALUE;
    const zoomPercent = Number(trimmed);
    return LIGHTBOX_ZOOM_LEVELS.includes(zoomPercent)
      ? String(zoomPercent)
      : null;
  }

  function normalizeExtensionValue(value: string): string {
    const v = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/^\.+/, "");
    return v && !v.includes("/") ? v : "";
  }

  function parseSelectedExtensionsParam(values: string[]): Set<string> {
    const extensions = new Set<string>();
    for (const rawValue of values) {
      const normalizedValue = String(rawValue ?? "").trim();
      if (!normalizedValue) continue;
      for (const item of normalizedValue.split(",")) {
        const ext = normalizeExtensionValue(item);
        if (ext) extensions.add(ext);
      }
    }
    return extensions;
  }

  function readInitialLocationState() {
    if (typeof window === "undefined") {
      return {
        directory: "",
        filePath: "",
        zoomValue: null as string | null,
        selectedExtensions: new Set<string>(),
        page: 1,
        pageSize: 20,
        filename: "",
      };
    }
    const url = new URL(window.location.href);
    const relativePath = url.searchParams.get("p") ?? "";
    const filePath = url.searchParams.get("f") ?? "";
    const zoomValue = normalizeLightboxZoomValue(url.searchParams.get("z"));
    const selectedExtensions = parseSelectedExtensionsParam(
      url.searchParams.getAll("ext"),
    );
    const rawPage = url.searchParams.get("page");
    const rawPageSize = url.searchParams.get("page-size");
    const filename =
      url.searchParams.get("name_filter") ??
      url.searchParams.get("filename") ??
      "";
    let page = 1;
    let pageSize: number | string = 20;
    const parsedPage = parseInt(rawPage ?? "", 10);
    if (Number.isFinite(parsedPage) && parsedPage > 0) page = parsedPage;
    if (rawPageSize !== null) {
      if (rawPageSize.toLowerCase() === "all") {
        pageSize = "All";
      } else {
        const parsed = parseInt(rawPageSize, 10);
        if (Number.isFinite(parsed) && parsed > 0) pageSize = parsed;
      }
    }
    let directory = "";
    let normalizedFilePath = "";
    try {
      directory = normalizeClientRelativeDirectory(relativePath);
    } catch {
      directory = "";
    }
    try {
      normalizedFilePath = normalizeClientRelativeDirectory(filePath);
    } catch {
      normalizedFilePath = "";
    }
    if (normalizedFilePath) {
      const parts = normalizedFilePath.split("/");
      parts.pop();
      directory = parts.join("/");
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

  let pendingInitialLightboxPath = "";

  function syncLocationState() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (ui.currentDir) {
      url.searchParams.set("p", ui.currentDir);
    } else {
      url.searchParams.delete("p");
    }
    url.searchParams.set("page", String(ui.page));
    url.searchParams.set("page-size", String(ui.pageSize));
    if (nameFilter) {
      url.searchParams.set("name_filter", nameFilter);
    } else {
      url.searchParams.delete("name_filter");
    }
    url.searchParams.delete("filename");
    url.searchParams.delete("ext");
    for (const ext of [...ui.requestedExtensions].sort()) {
      url.searchParams.append("ext", ext);
    }
    if (lightboxOpen && ui.lightboxPath) {
      url.searchParams.set("f", ui.lightboxPath);
      if (lightboxMode === "image") {
        url.searchParams.set("z", lightboxZoomValue);
      } else {
        url.searchParams.delete("z");
      }
    } else {
      url.searchParams.delete("f");
      url.searchParams.delete("z");
    }
    window.history.replaceState(
      {},
      "",
      url.pathname + (url.search ? url.search : ""),
    );
  }

  function isImageFile(extension: string): boolean {
    return imageExtensions.includes(String(extension || "").toLowerCase());
  }

  function isVideoFile(extension: string): boolean {
    return videoExtensions.includes(String(extension || "").toLowerCase());
  }

  function isZipFile(extension: string): boolean {
    return String(extension || "").toLowerCase() === "zip";
  }

  function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let index = 0;
    while (value >= 1000 && index < units.length - 1) {
      value /= 1000;
      index += 1;
    }
    return value.toFixed(2) + " " + units[index];
  }

  function formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  function formatImageDimensions(file: any): string {
    const width = Number(file?.width);
    const height = Number(file?.height);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      return "";
    return width + " x " + height;
  }

  function getAuthHeaders(): Record<string, string> {
    const session = readSession();
    if (!session) return {};
    return { "x-session-token": session.token };
  }

  function readSession(): {
    username: string;
    token: string;
    expiresAt: number;
  } | null {
    if (!authEnabled) {
      return {
        username: authUsername || "Guest",
        token: "",
        expiresAt: Date.now() + sessionExpiryMs,
      };
    }
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      if (
        typeof session.expiresAt !== "number" ||
        typeof session.token !== "string" ||
        !session.token ||
        Date.now() >= session.expiresAt
      ) {
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
    const session = {
      username,
      token,
      expiresAt: Date.now() + sessionExpiryMs,
    };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  function updateSessionInfo() {
    if (!authEnabled) {
      sessionInfoText = "Authentication disabled";
      return;
    }
    const session = readSession();
    if (!session) {
      sessionInfoText = "Session expired";
      return;
    }
    sessionInfoText = session.username;
  }

  function forceLogout(message = "Session ended. Please log in again.") {
    if (!authEnabled) {
      statusText = message;
      showApp();
      return;
    }
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    ui.selectedFiles = new Set();
    loginStatusText = message;
    showLogin();
  }

  function showLogin() {
    if (!authEnabled) {
      showApp();
      return;
    }
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
    loginStatusText = "Signing in...";
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: loginUsername,
          password: loginPassword,
        }),
      });
      const data = await response.json().catch(() => ({}));
      loginPending = false;
      if (!response.ok) {
        loginStatusText = data.error ?? "Login failed";
        return;
      }
      writeSession(loginUsername, data.token);
      loginStatusText = "";
      showApp();
      await initializeApp();
    } catch (error) {
      loginPending = false;
      loginStatusText = "Login failed";
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/logout", { method: "POST", headers: getAuthHeaders() });
    } catch {}
    forceLogout();
  }

  async function initializeApp(initialZoomValue?: string | null) {
    selectedExtensionsList = [...ui.requestedExtensions].sort();
    updateSelectedCount();
    await loadFiles();
    syncLocationState();
    if (pendingInitialLightboxPath) {
      const filePath = pendingInitialLightboxPath;
      pendingInitialLightboxPath = "";
      const mediaFile = ui.visibleMediaFiles.find(
        (f: any) => f.path === filePath,
      );
      if (mediaFile) {
        openLightbox(filePath);
        if (initialZoomValue && lightboxMode === "image") {
          setLightboxZoom(initialZoomValue);
        }
      }
    }
  }

  async function loadFiles() {
    if (!readSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    updateSessionInfo();
    loading = true;
    const requestId = ++loadFilesRequestId;
    try {
      const query = new URLSearchParams({
        dir: ui.currentDir,
        page: String(ui.page),
        pageSize: String(ui.pageSize),
        view: viewMode,
        name_filter: nameFilter,
      });
      for (const extension of [...ui.requestedExtensions].sort()) {
        query.append("ext", extension);
      }

      const response = await fetch("/api/files?" + query.toString(), {
        headers: getAuthHeaders(),
      });
      if (requestId !== loadFilesRequestId) return;

      if (response.status === 401) {
        forceLogout("Session expired: please log in again");
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (requestId !== loadFilesRequestId) return;

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load files");
      }

      if (
        data.selectedExtensions.length === 0 &&
        ui.requestedExtensions.size > 0
      ) {
        ui.requestedExtensions.clear();
        ui.selectedExtensions.clear();
        selectedExtensionsList = [];
      }
      if (data.extensions) {
        availableExtensions = data.extensions;
      }
      totalItems = data.directories.length + data.total;
      pageSizeOptions = data.pageSizeOptions;
      ui.page = data.page;
      ui.totalPages = data.totalPages;
      ui.currentDir = data.directory;
      ui.visibleMediaFiles = data.files.filter(
        (f: any) => isImageFile(f.extension) || isVideoFile(f.extension),
      );
      ui.totalMedia = data.totalMedia ?? 0;
      ui.mediaOffset = data.mediaOffset ?? 0;
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
      summaryFolderText =
        data.directories.length > 0 ? data.directories.length + " folders" : "";
      summaryFileText = data.total > 0 ? data.total + " files" : "";
      totalSizeText = data.total > 0 ? formatBytes(data.totalSize) : "";
      updateSelectedCount();
      statusText =
        data.directories.length || data.files.length ? "" : "No items found.";
      syncLocationState();
    } catch (error) {
      if (requestId !== loadFilesRequestId) return;
      statusText =
        error instanceof Error ? error.message : "Failed to load files";
    } finally {
      if (requestId === loadFilesRequestId) {
        loading = false;
      }
    }
  }

  function syncBreadcrumbState() {
    const segments = ui.currentDir ? ui.currentDir.split("/") : [];
    const items: { label: string; path: string }[] = [{ label: "/", path: "" }];
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? currentPath + "/" + segment : segment;
      items.push({ label: segment, path: currentPath });
    }
    breadcrumbs = items;
  }

  function updateSelectedCount() {
    selectedCountText = ui.selectedFiles.size + " selected";
    selectedFilePaths = [...ui.selectedFiles];
    hasSelection = ui.selectedFiles.size > 0;
  }

  function setFileSelection(filePath: string, checked: boolean) {
    if (!filePath) return;
    if (checked) ui.selectedFiles.add(filePath);
    else ui.selectedFiles.delete(filePath);
    ui.selectedFiles = new Set(ui.selectedFiles);
    updateSelectedCount();
  }

  function toggleSelectAllDirectories(checked: boolean) {
    for (const directory of directories) {
      setFileSelection(directory.path, checked);
    }
  }

  function toggleSelectAllFiles(checked: boolean) {
    for (const file of files) {
      setFileSelection(file.path, checked);
    }
  }

  async function toggleExtensionSelection(extension: string) {
    if (ui.requestedExtensions.has(extension)) {
      ui.requestedExtensions.delete(extension);
      ui.selectedExtensions.delete(extension);
    } else {
      ui.requestedExtensions.add(extension);
      ui.selectedExtensions.add(extension);
    }
    selectedExtensionsList = [...ui.requestedExtensions].sort();
    ui.page = 1;
    try {
      await loadFiles();
      syncLocationState();
    } catch {}
  }

  async function navigateToDirectory(relativePath: string) {
    if (!readSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    if (ui.currentDir !== relativePath) {
      ui.selectedFiles = new Set();
      updateSelectedCount();
      nameFilter = "";
    }
    ui.currentDir = relativePath;
    ui.page = 1;
    try {
      await loadFiles();
      syncLocationState();
    } catch {}
  }

  function changePageBy(delta: number) {
    const nextPage = ui.page + delta;
    if (nextPage < 1 || nextPage > ui.totalPages) return;
    ui.page = nextPage;
    loadFiles();
  }

  function setViewMode(mode: "list" | "grid") {
    viewMode = mode;
    ui.page = 1;
    loadFiles();
  }

  function getMediaUrl(filePath: string): string {
    const query = new URLSearchParams({ path: filePath });
    const session = readSession();
    if (authEnabled && session?.token) query.set("token", session.token);
    return "/media?" + query.toString();
  }

  function getThumbnailUrl(filePath: string): string {
    const query = new URLSearchParams({ path: filePath });
    const session = readSession();
    if (authEnabled && session?.token) query.set("token", session.token);
    return "/thumbnail?" + query.toString();
  }

  function getDownloadUrl(filePath: string): string {
    const query = new URLSearchParams({ path: filePath });
    const session = readSession();
    if (authEnabled && session?.token) query.set("token", session.token);
    return "/download?" + query.toString();
  }

  function videoRequiresPreparation(extension: string): boolean {
    return (
      isVideoFile(extension) && String(extension || "").toLowerCase() !== "webm"
    );
  }

  function getVideoPreparationEntry(
    filePath: string,
    extension: string,
  ): VideoPreparationEntry {
    const existing = videoPreparationByPath[filePath];
    if (existing) {
      return existing;
    }

    if (!isVideoFile(extension)) {
      return { ready: false, progress: 0, message: "", error: "" };
    }

    return {
      ready: !videoRequiresPreparation(extension),
      requiresConversion: videoRequiresPreparation(extension),
      progress: videoRequiresPreparation(extension) ? 0 : 100,
      message: videoRequiresPreparation(extension)
        ? "Preparing video for browser playback..."
        : "Video ready",
      error: "",
    };
  }

  function getGridVideoPreparationEntry(file: any): VideoPreparationEntry {
    return getVideoPreparationEntry(file.path, file.extension);
  }

  function gridVideoReady(file: any): boolean {
    return getGridVideoPreparationEntry(file).ready;
  }

  function gridVideoProgressLabel(file: any): string {
    return getGridVideoPreparationEntry(file).message;
  }

  function gridVideoProgressValue(file: any): string {
    return getGridVideoPreparationEntry(file).progress + "%";
  }

  function gridVideoProgressWidth(file: any): string {
    return getGridVideoPreparationEntry(file).progress + "%";
  }

  function gridVideoError(file: any): string {
    return getGridVideoPreparationEntry(file).error;
  }

  function syncLightboxVideoPreparation(
    filePath: string,
    entry: VideoPreparationEntry,
  ) {
    if (
      !lightboxOpen ||
      lightboxMode !== "video" ||
      lightboxPathValue !== filePath
    ) {
      return;
    }

    const progress = Math.max(0, Math.min(100, Number(entry.progress) || 0));
    lightboxVideoProgressLabel =
      entry.message || "Preparing video for browser playback...";
    lightboxVideoProgressValue = progress + "%";
    lightboxVideoProgressWidth = progress + "%";
    lightboxVideoErrorText = entry.error || "";

    if (entry.ready) {
      lightboxVideoUrl = getMediaUrl(filePath);
      lightboxVideoReady = true;
      window.requestAnimationFrame(() => {
        if (lightboxPathValue !== filePath || !lightboxOpen) {
          return;
        }

        syncSharedVideoSurface(filePath, "lightbox");
      });
      return;
    }

    lightboxVideoUrl = "";
    lightboxVideoReady = false;
  }

  function updateVideoPreparation(
    filePath: string,
    extension: string,
    entry: VideoPreparationEntry,
  ) {
    videoPreparationByPath = {
      ...videoPreparationByPath,
      [filePath]: entry,
    };

    if (lightboxPathValue === filePath) {
      syncLightboxVideoPreparation(
        filePath,
        getVideoPreparationEntry(filePath, extension),
      );
    }
  }

  async function fetchVideoPreparation(filePath: string) {
    const query = new URLSearchParams({ path: filePath });
    const response = await fetch("/api/video-preparation?" + query.toString(), {
      headers: getAuthHeaders(),
    });

    if (response.status === 401) {
      forceLogout("Session expired: please log in again");
      throw new Error("Session expired: please log in again");
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error ?? "Failed to prepare video");
    }

    return data;
  }

  async function ensureVideoPreparation(file: any) {
    if (!isVideoFile(file?.extension)) {
      return;
    }

    const currentEntry = getVideoPreparationEntry(file.path, file.extension);
    if (!currentEntry.requiresConversion || currentEntry.ready) {
      return;
    }

    if (activeVideoPreparationPolls.has(file.path)) {
      return;
    }

    activeVideoPreparationPolls.add(file.path);

    try {
      while (true) {
        const data = await fetchVideoPreparation(file.path);

        updateVideoPreparation(file.path, file.extension, {
          ready: !!data.ready,
          requiresConversion: data.requiresConversion !== false,
          progress: Math.max(0, Math.min(100, Number(data.progress) || 0)),
          message:
            data.message ||
            (data.ready
              ? "Video ready"
              : "Preparing video for browser playback..."),
          error: data.error || "",
        });

        if (data.ready || data.error) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } catch (error) {
      updateVideoPreparation(file.path, file.extension, {
        ready: false,
        progress: 0,
        message: "Preparing video for browser playback...",
        requiresConversion: true,
        error:
          error instanceof Error ? error.message : "Failed to prepare video",
      });
    } finally {
      activeVideoPreparationPolls.delete(file.path);
    }
  }

  async function uploadFiles(uploadInput: FileList | UploadCandidate[] | null) {
    if (!readSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    if (ui.isUploading) return;

    const uploadCandidates = Array.isArray(uploadInput)
      ? uploadInput
      : createUploadCandidatesFromFileList(uploadInput);

    if (!uploadCandidates.length) {
      statusText = "No files found to upload.";
      return;
    }

    const totalUploadBytes = uploadCandidates.reduce(
      (sum, entry) => sum + entry.file.size,
      0,
    );
    ui.isUploading = true;
    uploadBusy = true;
    uploadProgressVisible = true;
    statusText = "Uploading " + uploadCandidates.length + " file(s)...";

    let uploadedBytes = 0;
    const uploadedNames: string[] = [];

    try {
      for (const entry of uploadCandidates) {
        const formData = new FormData();
        formData.append("files", entry.file, entry.relativePath);
        const query = new URLSearchParams({ dir: ui.currentDir });

        const xhr = new XMLHttpRequest();
        await new Promise<void>((resolve, reject) => {
          xhr.open("POST", "/api/upload?" + query.toString());
          for (const [name, value] of Object.entries(getAuthHeaders()))
            xhr.setRequestHeader(name, value);
          xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
              const percent = Math.min(
                100,
                Math.round(
                  ((uploadedBytes + event.loaded) / totalUploadBytes) * 100,
                ),
              );
              uploadProgressWidth = percent + "%";
              uploadProgressValue = percent + "%";
              uploadProgressLabel =
                "Uploading " +
                uploadCandidates.length +
                " file(s): " +
                formatBytes(uploadedBytes + event.loaded) +
                " / " +
                formatBytes(totalUploadBytes);
            }
          });
          xhr.addEventListener("load", () => {
            const data = JSON.parse(xhr.responseText || "{}");
            if (xhr.status === 401) {
              reject(new Error("Session expired"));
              return;
            }
            if (xhr.status >= 200 && xhr.status < 300) {
              uploadedBytes += entry.file.size;
              uploadedNames.push(...data.uploaded);
              resolve();
            } else {
              reject(new Error(data.error ?? "Upload failed"));
            }
          });
          xhr.addEventListener("error", () =>
            reject(new Error("Upload failed.")),
          );
          xhr.send(formData);
        });
      }

      fileInputVersion += 1;
      await loadFiles();
      statusText = "Uploaded: " + uploadedNames.join(", ");
    } catch (error: any) {
      if (error.message === "Session expired") {
        forceLogout("Session expired: please log in again");
        return;
      }
      statusText = error.message || "Upload failed.";
    } finally {
      ui.isUploading = false;
      uploadBusy = false;
      uploadProgressVisible = false;
      uploadProgressWidth = "0%";
    }
  }

  async function handleDropzoneDrop(event: DragEvent) {
    event.preventDefault();
    dropzoneActive = false;
    await uploadFiles(await getDropUploadCandidates(event.dataTransfer));
  }

  async function openCompressDialog() {
    if (!readSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    if (!ui.selectedFiles.size) {
      statusText = "Select at least one file first";
      return;
    }
    if (zipSizeExceeded) return;
    const selectedPaths = [...ui.selectedFiles];
    if (selectedPaths.length === 1) {
      const singlePath = selectedPaths[0];
      const item = [...directories, ...files].find(
        (i: any) => i.path === singlePath,
      );
      const baseName = item?.name || "download";
      const nameWithoutExt = baseName.replace(/\.[^/.]+$/, "");
      compressDialogFileName = nameWithoutExt + ".zip";
    } else {
      const now = new Date();
      const y = String(now.getFullYear());
      const mo = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const h = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");
      const s = String(now.getSeconds()).padStart(2, "0");
      compressDialogFileName = `${y}${mo}${d}${h}${mi}${s}.zip`;
    }
    compressDialogErrorText = "";
    compressDialogTotalSize = selectedTotalSize;
    compressDialogImageFormat = commonImageExtension === "png" ? "png" : "jpeg";
    if (ui.selectedFiles.size > 0) {
      try {
        const query = new URLSearchParams({ dir: ui.currentDir });
        const response = await fetch("/api/selection-size?" + query.toString(), {
          method: "POST",
          headers: { "content-type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ items: [...ui.selectedFiles] }),
        });
        const data = await response.json();
        if (typeof data.totalSize === "number") {
          compressDialogTotalSize = data.totalSize;
        }
      } catch {}
    }
    if (compressDialogTotalSize > maxZipSize) return;
    compressDialogOpen = true;
  }

  function closeCompressDialog() {
    if (zipPending) return;
    compressDialogOpen = false;
    compressDialogFileName = "download.zip";
    compressDialogErrorText = "";
  }

  async function handleCompress() {
    if (!readSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    if (!ui.selectedFiles.size) {
      statusText = "Select at least one file first";
      return;
    }
    const fileName = compressDialogFileName.trim() || "download.zip";
    const folderName = ui.selectedFiles.size > 1
      ? fileName.replace(/\.zip$/i, "")
      : undefined;
    zipPending = true;
    compressDialogProgress = 0;
    compressDialogErrorText = "";
    const query = new URLSearchParams({ dir: ui.currentDir });
    const body: Record<string, any> = {
      items: [...ui.selectedFiles],
      filename: fileName,
      folderName,
    };
    if (commonImageInfo) {
      body.resizeWidth = compressDialogResizeWidth;
      body.resizeHeight = compressDialogResizeHeight;
      body.resizeQuality = compressDialogResizeQuality;
      body.imageFormat = compressDialogImageFormat;
    }
    const response = await fetch("/api/zip-selection?" + query.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      zipPending = false;
      compressDialogProgress = null;
      const data = await response.json().catch(() => ({}));
      compressDialogErrorText = data.error ?? "Failed to create zip file";
      return;
    }
    try {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      let zipToken: string | undefined;
      let zipFilename: string | undefined;

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        done = streamDone;
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line) continue;
            try {
              const data = JSON.parse(line);
              if (typeof data.p === "number") {
                compressDialogProgress = data.p;
              }
              if (data.token) {
                zipToken = data.token;
                zipFilename = data.filename;
              }
            } catch {}
          }
        }
      }

      zipPending = false;
      compressDialogProgress = null;

      if (zipToken && zipFilename) {
        compressDialogOpen = false;
        compressDialogErrorText = "";
        const link = document.createElement("a");
        link.href = `/api/zip-download?token=${encodeURIComponent(zipToken)}`;
        link.download = zipFilename;
        link.click();
        ui.selectedFiles = new Set();
        updateSelectedCount();
        statusText = "Downloaded zip: " + zipFilename;
      } else {
        compressDialogErrorText = "Failed to create zip file";
      }
    } catch {
      zipPending = false;
      compressDialogProgress = null;
      compressDialogErrorText = "Failed to create zip file";
    }
  }

  function openConfirmDialog(options: {
    title: string;
    message: string;
    confirmLabel: string;
  }): Promise<boolean> {
    confirmDialogTitleText = options.title;
    confirmDialogMessageText = options.message;
    confirmDialogConfirmLabel = options.confirmLabel;
    confirmDialogOpen = true;
    return new Promise((resolve) => {
      ui.confirmDialogResolver = resolve;
    });
  }

  function closeConfirmDialog(result: boolean) {
    if (!ui.confirmDialogResolver) return;
    const resolve = ui.confirmDialogResolver;
    ui.confirmDialogResolver = null;
    confirmDialogOpen = false;
    resolve(result);
  }

  function openUploadConflictDialog(
    fileName: string,
    suggestedName: string,
  ): Promise<{ action: string; fileName?: string }> {
    uploadConflictDialogTitleText = "File already exists";
    uploadConflictDialogMessageText =
      'A file named "' +
      fileName +
      '" already exists. Overwrite it or upload with a different name.';
    uploadConflictFileName = suggestedName;
    uploadConflictDialogErrorText = "";
    uploadConflictDialogOpen = true;
    return new Promise((resolve) => {
      ui.uploadConflictDialogResolver = resolve;
    });
  }

  function closeUploadConflictDialog(result: {
    action: string;
    fileName?: string;
  }) {
    if (!ui.uploadConflictDialogResolver) return;
    const resolve = ui.uploadConflictDialogResolver;
    ui.uploadConflictDialogResolver = null;
    uploadConflictDialogOpen = false;
    uploadConflictDialogErrorText = "";
    resolve(result);
  }

  function openCreateFolderDialog() {
    createFolderDialogTitleText = "Create folder";
    createFolderDialogMessageText =
      "Create a new folder in the current upload directory.";
    createFolderDialogName = "";
    createFolderDialogErrorText = "";
    createFolderDialogOpen = true;
  }

  function closeCreateFolderDialog() {
    if (createFolderPending) return;
    createFolderDialogOpen = false;
    createFolderDialogName = "";
    createFolderDialogErrorText = "";
  }

  async function deleteSelectedFiles() {
    if (!readSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    if (!ui.selectedFiles.size) {
      statusText = "Select at least one file first";
      return;
    }
    const confirmed = await openConfirmDialog({
      title: "Delete selected items?",
      message:
        "Delete " +
        ui.selectedFiles.size +
        " selected item(s)? Directories can only be deleted under upload. This action cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    deletePending = true;
    statusText = "Deleting selected items...";
    const query = new URLSearchParams({ dir: ui.currentDir });
    const response = await fetch("/api/delete-selection?" + query.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ items: [...ui.selectedFiles] }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      deletePending = false;
      statusText = data.error ?? "Failed to delete selected files";
      return;
    }
    ui.selectedFiles = new Set();
    updateSelectedCount();
    deletePending = false;
    statusText = "Deleted " + data.deleted.length + " item(s)";
    await loadFiles();
  }

  async function createFolder() {
    if (!readSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }

    if (createFolderPending) {
      return;
    }

    const trimmedFolderName = createFolderDialogName.trim();

    if (!trimmedFolderName) {
      createFolderDialogErrorText = "Folder name is required.";
      return;
    }

    createFolderPending = true;
    createFolderDialogErrorText = "";
    statusText = 'Creating folder "' + trimmedFolderName + '"...';

    try {
      const query = new URLSearchParams({ dir: ui.currentDir });
      const response = await fetch("/api/create_folder?" + query.toString(), {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ name: trimmedFolderName }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        closeCreateFolderDialog();
        forceLogout("Session expired: please log in again");
        return;
      }

      if (!response.ok) {
        createFolderDialogErrorText = data.error ?? "Failed to create folder";
        return;
      }

      createFolderDialogOpen = false;
      createFolderDialogName = "";
      statusText = 'Created folder "' + trimmedFolderName + '"';
      await loadFiles();
    } finally {
      createFolderPending = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      if (confirmDialogOpen) {
        closeConfirmDialog(false);
        return;
      }
      if (uploadConflictDialogOpen) {
        closeUploadConflictDialog({ action: "cancel" });
        return;
      }
      if (createFolderDialogOpen) {
        closeCreateFolderDialog();
        return;
      }
      if (lightboxOpen) {
        closeLightbox();
        return;
      }
    }
    if (event.key === "ArrowLeft" && !lightboxOpen && canGoPrev) {
      changePageBy(-1);
    }
    if (event.key === "ArrowRight" && !lightboxOpen && canGoNext) {
      changePageBy(1);
    }
    if (event.key === "ArrowUp" && lightboxOpen && lightboxMode === "image") {
      event.preventDefault();
      nudgeLightboxZoom(1);
      return;
    }
    if (event.key === "ArrowDown" && lightboxOpen && lightboxMode === "image") {
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
    const nextIndex = ui.visibleMediaFiles.findIndex(
      (f: any) => f.path === filePath,
    );
    if (nextIndex === -1) return;
    ui.lightboxIndex = nextIndex;
    ui.lightboxPath = filePath;
    lightboxOpen = true;
    setBodyScrollLocked(true);
    resetLightboxZoom();
    if (isVideoFile(currentFile.extension)) {
      handoffSharedVideoToSurface(filePath, "lightbox", true);
    }
    syncLightboxState();
    syncLocationState();
  }

  function closeLightbox() {
    const closingLightboxPath = lightboxPathValue;
    const lightboxVideo = getSharedVideoElementsByPath(
      closingLightboxPath,
    ).find((element) => getSharedVideoElementSurface(element) === "lightbox");
    const shouldRestoreGridVideo =
      lightboxMode === "video" && Boolean(closingLightboxPath && lightboxVideo);

    if (shouldRestoreGridVideo && lightboxVideo) {
      storeSharedVideoPlayback(closingLightboxPath, lightboxVideo, {
        preferredSurface: "grid",
        shouldResume: isSharedVideoPlaybackActive(lightboxVideo),
      });
      pauseSharedVideoElement(lightboxVideo);
    }

    ui.lightboxIndex = -1;
    ui.lightboxPath = "";
    ui.lightboxLoadToken += 1;
    lightboxOpen = false;
    lightboxMode = "";
    lightboxPathValue = "";
    lightboxImageUrl = "";
    lightboxVideoUrl = "";
    lightboxVideoReady = false;
    lightboxVideoProgressLabel = "Preparing video for browser playback...";
    lightboxVideoProgressValue = "0%";
    lightboxVideoProgressWidth = "0%";
    lightboxVideoErrorText = "";
    lightboxImageAlt = "";
    lightboxTitleValue = "";
    lightboxMetaItems = [];
    resetLightboxZoom();
    lightboxImageStyle = {};
    lightboxCanPan = false;
    lightboxDragging = false;
    ui.lightboxPinchActive = false;
    ui.lightboxImageNaturalWidth = 0;
    ui.lightboxImageNaturalHeight = 0;
    setBodyScrollLocked(false);
    syncLocationState();

    if (shouldRestoreGridVideo && closingLightboxPath) {
      window.requestAnimationFrame(() => {
        syncSharedVideoSurface(closingLightboxPath, "grid");
      });
    }
  }

  function syncLightboxState() {
    if (lightboxMode === "video" && lightboxPathValue) {
      const currentLightboxVideo = getSharedVideoElementsByPath(
        lightboxPathValue,
      ).find((element) => getSharedVideoElementSurface(element) === "lightbox");

      storeSharedVideoPlayback(
        lightboxPathValue,
        currentLightboxVideo ?? null,
        {
          preferredSurface: "grid",
          shouldResume: false,
        },
      );
      pauseSharedVideoElement(currentLightboxVideo ?? null);
    }

    const currentFile = ui.visibleMediaFiles[ui.lightboxIndex];
    if (!currentFile) {
      closeLightbox();
      return;
    }
    ui.lightboxPath = currentFile.path;
    lightboxPathValue = currentFile.path;
    const isImage = isImageFile(currentFile.extension);
    const isVideo = isVideoFile(currentFile.extension);
    lightboxMode = isVideo ? "video" : isImage ? "image" : "";
    lightboxImageUrl = isImage ? getMediaUrl(currentFile.path) : "";
    lightboxVideoUrl = "";
    lightboxVideoReady = false;
    lightboxVideoProgressLabel = "Preparing video for browser playback...";
    lightboxVideoProgressValue = "0%";
    lightboxVideoProgressWidth = "0%";
    lightboxVideoErrorText = "";
    lightboxImageAlt = isImage ? currentFile.name : "";
    lightboxTitleValue = currentFile.name;
    lightboxMetaItems = [
      {
        key: "extension",
        text: "." + (currentFile.extension || "none"),
        badge: true,
      },
      {
        key: "position",
        text: `${ui.mediaOffset + ui.lightboxIndex + 1} / ${ui.totalMedia}`,
        badge: false,
      },
      { key: "size", text: formatBytes(currentFile.size), badge: false },
      ...(formatImageDimensions(currentFile)
        ? [
            {
              key: "dimensions",
              text: formatImageDimensions(currentFile),
              badge: false,
            },
          ]
        : []),
      {
        key: "modified",
        text: formatDateTime(currentFile.modifiedAt),
        badge: false,
      },
    ];
    lightboxPrevDisabled = ui.page <= 1 && ui.lightboxIndex <= 0;
    lightboxNextDisabled =
      ui.page >= ui.totalPages &&
      ui.lightboxIndex >= ui.visibleMediaFiles.length - 1;
    ui.lightboxImageNaturalWidth = 0;
    ui.lightboxImageNaturalHeight = 0;
    resetLightboxZoom();
    if (isVideo) {
      handoffSharedVideoToSurface(currentFile.path, "lightbox", true);
      syncLightboxVideoPreparation(
        currentFile.path,
        getVideoPreparationEntry(currentFile.path, currentFile.extension),
      );
      ensureVideoPreparation(currentFile);
    }
  }

  function getSharedVideoPlaybackEntry(
    filePath: string,
  ): SharedVideoPlaybackEntry {
    const normalizedPath = String(filePath || "");

    if (!normalizedPath) {
      return {
        currentTime: 0,
        shouldResume: false,
        preferredSurface: "grid",
      };
    }

    const existing = sharedVideoPlaybackByPath.get(normalizedPath);
    if (existing) {
      return existing;
    }

    const entry: SharedVideoPlaybackEntry = {
      currentTime: 0,
      shouldResume: false,
      preferredSurface: "grid",
    };
    sharedVideoPlaybackByPath.set(normalizedPath, entry);
    return entry;
  }

  function updateSharedVideoPlayback(
    filePath: string,
    nextValues: Partial<SharedVideoPlaybackEntry>,
  ): SharedVideoPlaybackEntry {
    if (!filePath) {
      return getSharedVideoPlaybackEntry(filePath);
    }

    const entry = getSharedVideoPlaybackEntry(filePath);
    Object.assign(entry, nextValues);
    return entry;
  }

  function storeSharedVideoPlayback(
    filePath: string,
    element: HTMLVideoElement | null,
    nextValues: Partial<SharedVideoPlaybackEntry> = {},
  ): SharedVideoPlaybackEntry {
    if (!filePath) {
      return getSharedVideoPlaybackEntry(filePath);
    }

    const currentTime =
      element instanceof HTMLVideoElement &&
      Number.isFinite(element.currentTime)
        ? Math.max(0, element.currentTime)
        : undefined;

    return updateSharedVideoPlayback(filePath, {
      ...(currentTime === undefined ? {} : { currentTime }),
      ...nextValues,
    });
  }

  function runWithSharedVideoSyncSuppressed<T>(callback: () => T): T {
    sharedVideoSyncDepth += 1;

    try {
      return callback();
    } finally {
      sharedVideoSyncDepth = Math.max(0, sharedVideoSyncDepth - 1);
    }
  }

  function shouldIgnoreSharedVideoEvent(
    filePath: string,
    element: EventTarget | null,
  ): boolean {
    return (
      sharedVideoSyncDepth > 0 ||
      !filePath ||
      !(element instanceof HTMLVideoElement)
    );
  }

  function getSharedVideoElements(): HTMLVideoElement[] {
    if (typeof document === "undefined") {
      return [];
    }

    return [...document.querySelectorAll("video[data-shared-video]")].filter(
      (element): element is HTMLVideoElement =>
        element instanceof HTMLVideoElement && element.isConnected,
    );
  }

  function getSharedVideoElementPath(element: HTMLVideoElement): string {
    return String(element.dataset.videoPath || "");
  }

  function getSharedVideoElementSurface(
    element: HTMLVideoElement,
  ): "grid" | "lightbox" | "" {
    const surface = String(element.dataset.sharedVideo || "");
    return surface === "grid" || surface === "lightbox" ? surface : "";
  }

  function isSharedVideoPlaybackActive(
    element: HTMLVideoElement | null,
  ): boolean {
    return !!element && !element.paused && !element.ended;
  }

  function getSharedVideoElementsByPath(filePath: string): HTMLVideoElement[] {
    return getSharedVideoElements().filter(
      (element) => getSharedVideoElementPath(element) === filePath,
    );
  }

  function getPreferredSharedVideoElement(
    filePath: string,
  ): HTMLVideoElement | null {
    const matchingElements = getSharedVideoElementsByPath(filePath);
    const activeElement = matchingElements.find((element) =>
      isSharedVideoPlaybackActive(element),
    );

    if (activeElement) {
      return activeElement;
    }

    return (
      matchingElements.find(
        (element) => getSharedVideoElementSurface(element) === "lightbox",
      ) ??
      matchingElements[0] ??
      null
    );
  }

  function clampSharedVideoTime(
    element: HTMLVideoElement,
    currentTime: number,
  ): number {
    if (!Number.isFinite(currentTime)) {
      return 0;
    }

    if (!Number.isFinite(element.duration)) {
      return Math.max(0, currentTime);
    }

    return Math.min(
      Math.max(0, currentTime),
      Math.max(0, element.duration - 0.25),
    );
  }

  function pauseSharedVideoElement(element: HTMLVideoElement | null) {
    if (!element || element.paused) {
      return;
    }

    runWithSharedVideoSyncSuppressed(() => {
      element.pause();
    });
  }

  function pauseOtherSharedVideos(
    activeFilePath: string,
    activeElement: HTMLVideoElement | null = null,
  ) {
    for (const element of getSharedVideoElements()) {
      if (element === activeElement) {
        continue;
      }

      const filePath = getSharedVideoElementPath(element);
      if (!filePath) {
        continue;
      }

      storeSharedVideoPlayback(
        filePath,
        element,
        filePath === activeFilePath ? {} : { shouldResume: false },
      );
      pauseSharedVideoElement(element);
    }
  }

  function applySharedVideoPlaybackToElement(
    filePath: string,
    surface: "grid" | "lightbox",
    element: HTMLVideoElement,
  ) {
    if (!filePath) {
      return;
    }

    const entry = getSharedVideoPlaybackEntry(filePath);

    runWithSharedVideoSyncSuppressed(() => {
      if (element.readyState >= 1 && Number.isFinite(entry.currentTime)) {
        const targetTime = clampSharedVideoTime(element, entry.currentTime);

        if (Math.abs(element.currentTime - targetTime) > 0.2) {
          element.currentTime = targetTime;
        }
      }

      if (entry.shouldResume && entry.preferredSurface === surface) {
        pauseOtherSharedVideos(filePath, element);
        const playResult = element.play();
        if (playResult && typeof playResult.catch === "function") {
          playResult.catch(() => {});
        }
        return;
      }

      if (!element.paused) {
        element.pause();
      }
    });
  }

  function handoffSharedVideoToSurface(
    filePath: string,
    surface: "grid" | "lightbox",
    defaultShouldResume = false,
  ) {
    if (!filePath) {
      return;
    }

    const entry = getSharedVideoPlaybackEntry(filePath);
    const sourceElement = getPreferredSharedVideoElement(filePath);
    const shouldResume = sourceElement
      ? isSharedVideoPlaybackActive(sourceElement) || defaultShouldResume
      : entry.shouldResume || defaultShouldResume;

    storeSharedVideoPlayback(filePath, sourceElement, {
      preferredSurface: surface,
      shouldResume,
    });
    pauseOtherSharedVideos(filePath, null);
  }

  function syncSharedVideoSurface(
    filePath: string,
    surface: "grid" | "lightbox",
  ) {
    if (!filePath) {
      return;
    }

    const targetElement = getSharedVideoElementsByPath(filePath).find(
      (element) => getSharedVideoElementSurface(element) === surface,
    );

    if (!targetElement) {
      return;
    }

    applySharedVideoPlaybackToElement(filePath, surface, targetElement);
  }

  function handleSharedVideoPlay(
    filePath: string,
    surface: "grid" | "lightbox",
    element: EventTarget | null,
  ) {
    if (shouldIgnoreSharedVideoEvent(filePath, element)) {
      return;
    }

    const videoEl = element as HTMLVideoElement | null;
    storeSharedVideoPlayback(filePath, videoEl, {
      shouldResume: true,
      preferredSurface: surface,
    });
    pauseOtherSharedVideos(filePath, videoEl);
  }

  function handleSharedVideoPause(
    filePath: string,
    surface: "grid" | "lightbox",
    element: EventTarget | null,
  ) {
    if (shouldIgnoreSharedVideoEvent(filePath, element)) {
      return;
    }

    const videoEl = element as HTMLVideoElement | null;
    storeSharedVideoPlayback(filePath, videoEl, {
      shouldResume: false,
      preferredSurface: surface,
    });
  }

  function handleSharedVideoTimeUpdate(
    filePath: string,
    element: EventTarget | null,
  ) {
    if (shouldIgnoreSharedVideoEvent(filePath, element)) {
      return;
    }

    const videoEl = element as HTMLVideoElement | null;
    storeSharedVideoPlayback(filePath, videoEl, {
      shouldResume: isSharedVideoPlaybackActive(videoEl),
    });
  }

  function handleSharedVideoSeeked(
    filePath: string,
    element: EventTarget | null,
  ) {
    if (shouldIgnoreSharedVideoEvent(filePath, element)) {
      return;
    }

    storeSharedVideoPlayback(filePath, element as HTMLVideoElement | null);
  }

  function handleSharedVideoLoadedMetadata(
    filePath: string,
    surface: "grid" | "lightbox",
    element: EventTarget | null,
  ) {
    if (!filePath || !(element instanceof HTMLVideoElement)) {
      return;
    }

    applySharedVideoPlaybackToElement(filePath, surface, element);
  }

  function handleSharedVideoEnded(
    filePath: string,
    surface: "grid" | "lightbox",
    element: EventTarget | null,
  ) {
    if (shouldIgnoreSharedVideoEvent(filePath, element)) {
      return;
    }

    storeSharedVideoPlayback(filePath, element as HTMLVideoElement | null, {
      shouldResume: false,
      preferredSurface: surface,
    });
  }

  async function openArchiveLightbox(file: any) {
    ui.lightboxIndex = -1;
    ui.lightboxPath = file.path;
    lightboxOpen = true;
    lightboxMode = "zip";
    lightboxPathValue = file.path;
    lightboxTitleValue = file.name;
    lightboxMetaItems = [
      { key: "extension", text: "." + (file.extension || "none"), badge: true },
      { key: "size", text: formatBytes(file.size), badge: false },
    ];
    lightboxPrevDisabled = true;
    lightboxNextDisabled = true;
    lightboxZipLoading = true;
    lightboxZipErrorText = "";
    lightboxZipRootDirectories = [];
    lightboxZipFiles = [];
    lightboxZipBreadcrumbs = [{ label: "/", path: "" }];
    setBodyScrollLocked(true);
    syncLocationState();

    try {
      const query = new URLSearchParams({ path: file.path });
      const response = await fetch(
        "/api/archive-contents?" + query.toString(),
        { headers: getAuthHeaders() },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Failed to read archive contents");
      archivePreviewDirectories = data.directories || [];
      archivePreviewFiles = data.files || [];
      setArchivePreviewDirectory("");
    } catch (error: any) {
      lightboxZipErrorText =
        error.message || "Failed to read archive contents.";
    } finally {
      lightboxZipLoading = false;
    }
  }

  let archivePreviewFiles: any[] = $state([]);
  let archivePreviewDirectories: any[] = $state([]);
  let archivePreviewCurrentDirectory = $state("");

  function setArchivePreviewDirectory(relativePath: string) {
    archivePreviewCurrentDirectory = relativePath;
    lightboxZipCurrentDirectory = relativePath;
    lightboxZipRootDirectories = archivePreviewDirectories.filter(
      (d: any) => d.parentPath === relativePath,
    );
    lightboxZipFiles = archivePreviewFiles.filter(
      (f: any) => f.parentPath === relativePath,
    );
    const segments = relativePath ? relativePath.split("/") : [];
    const items: { label: string; path: string }[] = [{ label: "/", path: "" }];
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? currentPath + "/" + segment : segment;
      items.push({ label: segment, path: currentPath });
    }
    lightboxZipBreadcrumbs = items;
  }

  async function stepLightbox(direction: number) {
    if (lightboxMode === "zip" || !ui.visibleMediaFiles.length) return;
    const nextIndex = ui.lightboxIndex + direction;
    if (nextIndex >= 0 && nextIndex < ui.visibleMediaFiles.length) {
      ui.lightboxIndex = nextIndex;
      ui.lightboxPath = ui.visibleMediaFiles[nextIndex].path;
      syncLightboxState();
      return;
    }
    if (direction > 0 && ui.page < ui.totalPages) {
      ui.page += 1;
      await loadFiles();
      if (ui.visibleMediaFiles.length > 0) {
        ui.lightboxIndex = 0;
        ui.lightboxPath = ui.visibleMediaFiles[0].path;
        syncLightboxState();
      }
    } else if (direction < 0 && ui.page > 1) {
      ui.page -= 1;
      await loadFiles();
      if (ui.visibleMediaFiles.length > 0) {
        ui.lightboxIndex = ui.visibleMediaFiles.length - 1;
        ui.lightboxPath =
          ui.visibleMediaFiles[ui.visibleMediaFiles.length - 1].path;
        syncLightboxState();
      }
    }
  }

  function getArchiveEntryDownloadUrl(file: any): string {
    const query = new URLSearchParams({
      path: ui.lightboxPath,
      entry: file.path,
    });
    const session = readSession();
    if (authEnabled && session?.token) query.set("token", session.token);
    return "/archive-entry-download?" + query.toString();
  }

  function setBodyScrollLocked(locked: boolean) {
    document.body.classList.toggle("overflow-hidden", locked);
  }

  function getLightboxImageMaxHeight(): number {
    if (typeof window === "undefined") return 0;
    const headerApprox = 120;
    return Math.max(0, window.innerHeight - headerApprox - 48);
  }

  function getLightboxImageMaxWidth(): number {
    if (typeof window === "undefined") return 0;
    return Math.max(0, window.innerWidth - 48);
  }

  function getFitHeightZoomPercent(): number {
    const currentFile = ui.visibleMediaFiles[ui.lightboxIndex] ?? null;
    const sourceHeight =
      ui.lightboxImageNaturalHeight || Number(currentFile?.height) || 0;
    if (!sourceHeight) return 100;
    const maxHeight = getLightboxImageMaxHeight();
    if (!maxHeight) return 100;
    return Math.max(1, Math.min(100, (maxHeight / sourceHeight) * 100));
  }

  function getFitZoomPercent(): number {
    const currentFile = ui.visibleMediaFiles[ui.lightboxIndex] ?? null;
    const sourceWidth =
      ui.lightboxImageNaturalWidth || Number(currentFile?.width) || 0;
    const sourceHeight =
      ui.lightboxImageNaturalHeight || Number(currentFile?.height) || 0;
    if (!sourceWidth || !sourceHeight) return getFitHeightZoomPercent();
    const maxHeight = getLightboxImageMaxHeight();
    const maxWidth = getLightboxImageMaxWidth();
    if (!maxHeight || !maxWidth) return 100;
    const scaleH = maxHeight / sourceHeight;
    const scaleW = maxWidth / sourceWidth;
    const scale = Math.min(scaleH, scaleW);
    return Math.max(1, Math.min(100, scale * 100));
  }

  function buildLightboxZoomOptions(
    fitZoomPercent: number,
  ): { value: string; label: string; sortValue: number }[] {
    const roundedFitZoomPercent = Math.round(fitZoomPercent);
    return [
      {
        value: LIGHTBOX_FIT_ZOOM_VALUE,
        label: roundedFitZoomPercent + "%",
        sortValue: fitZoomPercent,
      },
      ...LIGHTBOX_ZOOM_LEVELS.map((level) => ({
        value: String(level),
        label: level + "%",
        sortValue: level,
      })),
    ].sort((left, right) => left.sortValue - right.sortValue);
  }

  function getCurrentLightboxZoomPercent(): number {
    if (lightboxZoomValue === LIGHTBOX_FIT_ZOOM_VALUE)
      return getFitZoomPercent();
    const parsed = Number(lightboxZoomValue);
    return Number.isFinite(parsed) ? parsed : 100;
  }

  function updateLightboxZoomOptionLabels() {
    const fitPercent = getFitZoomPercent();
    lightboxZoomOptions = buildLightboxZoomOptions(fitPercent);
    const current = lightboxZoomOptions.find(
      (o) => o.value === lightboxZoomValue,
    );
    lightboxZoomLabel = current?.label ?? "Fit";
  }

  function updateLightboxZoomControls() {
    if (lightboxMode !== "image") {
      lightboxZoomOutDisabled = true;
      lightboxZoomInDisabled = true;
      return;
    }
    const currentZoomPercent = getCurrentLightboxZoomPercent();
    const sorted = [...lightboxZoomOptions].sort(
      (a, b) => a.sortValue - b.sortValue,
    );
    lightboxZoomOutDisabled = false;
    lightboxZoomInDisabled = !sorted.some(
      (o) => o.sortValue > currentZoomPercent,
    );
  }

  function updateLightboxImageStyle() {
    if (lightboxMode !== "image") {
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
      width: Math.max(1, Math.round(naturalWidth * zoomScale)) + "px",
      height: Math.max(1, Math.round(naturalHeight * zoomScale)) + "px",
      maxWidth: "none",
      maxHeight: "none",
    };
    syncLightboxPanAvailability();
  }

  function syncLightboxPanAvailability() {
    if (lightboxMode !== "image") {
      lightboxCanPan = false;
      lightboxDragging = false;
      return;
    }
    window.requestAnimationFrame(() => {
      const backdrop = document.getElementById("lightboxBackdrop");
      if (!backdrop || lightboxMode !== "image") {
        lightboxCanPan = false;
        lightboxDragging = false;
        return;
      }
      const canPan =
        backdrop.scrollWidth > backdrop.clientWidth ||
        backdrop.scrollHeight > backdrop.clientHeight;
      lightboxCanPan = canPan;
      if (!canPan) {
        lightboxDragging = false;
        ui.lightboxPanPointerId = null;
      }
    });
  }

  function captureLightboxCenterAnchor(): {
    centerRatioX: number;
    centerRatioY: number;
  } | null {
    const backdrop = document.getElementById("lightboxBackdrop");
    if (!backdrop) return null;
    const centerX = backdrop.scrollLeft + backdrop.clientWidth / 2;
    const centerY = backdrop.scrollTop + backdrop.clientHeight / 2;
    const scrollWidth = backdrop.scrollWidth;
    const scrollHeight = backdrop.scrollHeight;
    return {
      centerRatioX: scrollWidth > 0 ? centerX / scrollWidth : 0.5,
      centerRatioY: scrollHeight > 0 ? centerY / scrollHeight : 0.5,
    };
  }

  function restoreLightboxCenterAnchor(
    anchor: { centerRatioX: number; centerRatioY: number } | null,
  ) {
    if (!anchor) return;
    window.requestAnimationFrame(() => {
      const backdrop = document.getElementById("lightboxBackdrop");
      if (!backdrop) return;
      const nextCenterX = backdrop.scrollWidth * anchor.centerRatioX;
      const nextCenterY = backdrop.scrollHeight * anchor.centerRatioY;
      backdrop.scrollLeft = Math.max(0, nextCenterX - backdrop.clientWidth / 2);
      backdrop.scrollTop = Math.max(0, nextCenterY - backdrop.clientHeight / 2);
    });
  }

  function resetLightboxZoom() {
    lightboxZoomValue = LIGHTBOX_FIT_ZOOM_VALUE;
    lightboxZoomMenuOpen = false;
    ui.lightboxPinchActive = false;
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
    syncLocationState();
  }

  function nudgeLightboxZoom(direction: number) {
    if (lightboxMode !== "image") return;
    const currentZoomPercent = getCurrentLightboxZoomPercent();
    const sorted = [...lightboxZoomOptions].sort(
      (a, b) => a.sortValue - b.sortValue,
    );
    const presetOnly = sorted.filter(
      (o) => o.value !== LIGHTBOX_FIT_ZOOM_VALUE,
    );
    if (direction > 0) {
      const nextOption = sorted.find((o) => o.sortValue > currentZoomPercent);
      if (nextOption) setLightboxZoom(nextOption.value);
    } else {
      if (lightboxZoomValue === LIGHTBOX_FIT_ZOOM_VALUE) {
        const fitOption = sorted.find(
          (o) => o.value === LIGHTBOX_FIT_ZOOM_VALUE,
        );
        const lowestPreset = presetOnly[0] ?? null;
        if (
          lowestPreset &&
          fitOption &&
          lowestPreset.sortValue < fitOption.sortValue
        ) {
          setLightboxZoom(lowestPreset.value);
        }
      } else {
        const fitOption = sorted.find(
          (o) => o.value === LIGHTBOX_FIT_ZOOM_VALUE,
        );
        const prevOption = [...presetOnly]
          .reverse()
          .find((o) => o.sortValue < currentZoomPercent);
        if (
          prevOption &&
          (!fitOption || prevOption.sortValue >= fitOption.sortValue)
        ) {
          setLightboxZoom(prevOption.value);
        } else if (fitOption && fitOption.sortValue < currentZoomPercent) {
          setLightboxZoom(LIGHTBOX_FIT_ZOOM_VALUE);
        }
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
    if (ui.lightboxPinchActive) return;
    const backdrop = document.getElementById("lightboxBackdrop");
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
    if (!lightboxDragging || ui.lightboxPanPointerId !== event.pointerId)
      return;
    if (ui.lightboxPinchActive) return;
    const backdrop = document.getElementById("lightboxBackdrop");
    if (!backdrop) {
      endLightboxPan(event);
      return;
    }
    const deltaX = event.clientX - ui.lightboxPanStartX;
    const deltaY = event.clientY - ui.lightboxPanStartY;
    backdrop.scrollLeft = ui.lightboxPanScrollLeft - deltaX;
    backdrop.scrollTop = ui.lightboxPanScrollTop - deltaY;
    if (
      !ui.lightboxPanMoved &&
      (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3)
    ) {
      ui.lightboxPanMoved = true;
    }
    event.preventDefault();
  }

  function endLightboxPan(event: PointerEvent) {
    if (ui.lightboxPanPointerId !== event.pointerId) return;
    if (ui.lightboxPinchActive) return;
    const backdrop = document.getElementById("lightboxBackdrop");
    if (backdrop?.hasPointerCapture(event.pointerId)) {
      backdrop.releasePointerCapture(event.pointerId);
    }
    ui.lightboxPanPointerId = null;
    lightboxDragging = false;
    window.setTimeout(() => {
      ui.lightboxPanMoved = false;
    }, 0);
  }

  function handleLightboxPinchStart(event: TouchEvent) {
    if (lightboxMode !== "image") return;
    if (event.touches.length < 2) return;
    event.preventDefault();
    if (lightboxDragging) {
      const backdrop = document.getElementById("lightboxBackdrop");
      if (
        backdrop &&
        ui.lightboxPanPointerId !== null &&
        backdrop.hasPointerCapture(ui.lightboxPanPointerId)
      ) {
        backdrop.releasePointerCapture(ui.lightboxPanPointerId);
      }
      ui.lightboxPanPointerId = null;
      lightboxDragging = false;
      ui.lightboxPanMoved = false;
    }
    const t0 = event.touches[0];
    const t1 = event.touches[1];
    ui.lightboxPinchActive = true;
    ui.lightboxPinchStartDist = Math.hypot(
      t1.clientX - t0.clientX,
      t1.clientY - t0.clientY,
    );
    ui.lightboxPinchStartZoomPercent = getCurrentLightboxZoomPercent();
    ui.lightboxPinchMidX = (t0.clientX + t1.clientX) / 2;
    ui.lightboxPinchMidY = (t0.clientY + t1.clientY) / 2;
    ui.lightboxPinchLastPercent = ui.lightboxPinchStartZoomPercent;
    ui.lightboxPinchFitPercent = getFitZoomPercent();
  }

  function handleLightboxPinchMove(event: TouchEvent) {
    if (!ui.lightboxPinchActive) return;
    if (event.touches.length < 2) return;
    event.preventDefault();
    const t0 = event.touches[0];
    const t1 = event.touches[1];
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    const scale = dist / ui.lightboxPinchStartDist;
    let targetPercent = ui.lightboxPinchStartZoomPercent * scale;
    targetPercent = Math.max(
      ui.lightboxPinchFitPercent,
      Math.min(300, targetPercent),
    );
    ui.lightboxPinchLastPercent = targetPercent;
    const naturalW = ui.lightboxImageNaturalWidth;
    const naturalH = ui.lightboxImageNaturalHeight;
    if (!naturalW || !naturalH) return;
    const zoomScale = targetPercent / 100;
    lightboxImageStyle = {
      width: Math.max(1, Math.round(naturalW * zoomScale)) + "px",
      height: Math.max(1, Math.round(naturalH * zoomScale)) + "px",
      maxWidth: "none",
      maxHeight: "none",
    };
    const backdrop = document.getElementById("lightboxBackdrop");
    if (backdrop) {
      const midOffsetX =
        ui.lightboxPinchMidX - backdrop.getBoundingClientRect().left;
      const midOffsetY =
        ui.lightboxPinchMidY - backdrop.getBoundingClientRect().top;
      const prevCenterX = backdrop.scrollLeft + midOffsetX;
      const prevCenterY = backdrop.scrollTop + midOffsetY;
      const newScrollX = prevCenterX * scale - midOffsetX;
      const newScrollY = prevCenterY * scale - midOffsetY;
      backdrop.scrollLeft = Math.max(0, newScrollX);
      backdrop.scrollTop = Math.max(0, newScrollY);
    }
    lightboxCanPan = true;
  }

  function handleLightboxPinchEnd(event: TouchEvent) {
    if (!ui.lightboxPinchActive) return;
    if (event.touches.length >= 2) return;
    ui.lightboxPinchActive = false;
    const finalPercent = ui.lightboxPinchLastPercent;
    if (finalPercent <= ui.lightboxPinchFitPercent) {
      setLightboxZoom(LIGHTBOX_FIT_ZOOM_VALUE);
      return;
    }
    const sorted = [...lightboxZoomOptions].sort(
      (a, b) => a.sortValue - b.sortValue,
    );
    let nearest = sorted[0];
    let minDist = Infinity;
    for (const opt of sorted) {
      const d = Math.abs(opt.sortValue - finalPercent);
      if (d < minDist) {
        minDist = d;
        nearest = opt;
      }
    }
    if (nearest) {
      setLightboxZoom(nearest.value);
    }
  }

  function handleLightboxBackdropClick(event: MouseEvent) {
    if (ui.lightboxPanMoved) {
      event.preventDefault();
      return;
    }
    if (lightboxMode === "video") {
      return;
    }
    closeLightbox();
  }

  let appInitialized = false;

  $effect(() => {
    if (typeof window === "undefined" || appInitialized) return;
    appInitialized = true;
    const existingSession = readSession();
    if (!authEnabled || existingSession) {
      const initialLocation = readInitialLocationState();
      ui.currentDir = initialLocation.directory;
      ui.page = initialLocation.page;
      ui.pageSize = initialLocation.pageSize;
      nameFilter = initialLocation.filename;
      pageSizeDisplay = String(initialLocation.pageSize);
      ui.requestedExtensions = new Set(initialLocation.selectedExtensions);
      ui.selectedExtensions = new Set(initialLocation.selectedExtensions);
      pendingInitialLightboxPath = initialLocation.filePath;
      showApp();
      initializeApp(initialLocation.zoomValue);
    } else {
      showLogin();
    }
  });

  $effect(() => {
    fileInputOpenToken;
    if (fileInputRef && fileInputOpenToken !== fileInputLastHandled) {
      fileInputLastHandled = fileInputOpenToken;
      fileInputRef.value = "";
      fileInputRef.click();
    }
  });

  $effect(() => {
    if (!pageSizeMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        pageSizeContainerRef &&
        !pageSizeContainerRef.contains(e.target as Node)
      ) {
        pageSizeMenuOpen = false;
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  });

  $effect(() => {
    if (viewMode !== "grid" || !files.length) {
      return;
    }

    for (const file of files) {
      if (!isVideoFile(file.extension)) {
        continue;
      }

      const entry = videoPreparationByPath[file.path];

      if (entry?.ready || entry?.error) {
        continue;
      }

      ensureVideoPreparation(file);
    }
  });

  $effect(() => {
    if (foldersHeaderCheckboxRef) {
      foldersHeaderCheckboxRef.indeterminate = directoriesSomeSelected;
    }
  });

  $effect(() => {
    if (filesHeaderCheckboxRef) {
      filesHeaderCheckboxRef.indeterminate = filesSomeSelected;
    }
  });

  let nameFilterTimer: ReturnType<typeof setTimeout> | null = null;
  let nameFilterReady = false;

  $effect(() => {
    const filter = nameFilter;
    if (!nameFilterReady) {
      nameFilterReady = true;
      return;
    }
    if (nameFilterTimer) clearTimeout(nameFilterTimer);
    nameFilterTimer = setTimeout(() => {
      ui.page = 1;
      loadFiles();
    }, 300);
    return () => {
      if (nameFilterTimer) clearTimeout(nameFilterTimer);
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#snippet tooltip(label: string)}
  <span class="fm-tooltip">{label}</span>
{/snippet}

{#if showLoginShell}
  <Login
    bind:username={loginUsername}
    bind:password={loginPassword}
    bind:rememberMe
    bind:passwordVisible
    bind:loginStatusText
    bind:loginPending
    onLogin={handleLogin}
  />
{/if}

{#if showAppShell}
  <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <div class="mb-3 sm:mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">File Manager</h1>
        <p class="mt-2 text-sm text-slate-400">
          Browse files as a paginated tree, upload new files, and bundle
          selected files into a zip archive.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <div class="fm-pill hidden sm:block">
          {sessionInfoText}
        </div>
        {#if summaryText}
          <div class="text-sm text-slate-300">
            {summaryText}
          </div>
        {/if}
        {#if authEnabled}
          <button
            onclick={handleLogout}
            type="button"
            aria-label="Log out"
            class="group relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-100 transition hover:border-rose-500 hover:text-rose-200"
          >
            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"
              ><path
                fill-rule="evenodd"
                d="M3.75 4.5A2.25 2.25 0 0 1 6 2.25h4a.75.75 0 0 1 0 1.5H6A.75.75 0 0 0 5.25 4.5v11A.75.75 0 0 0 6 16.25h4a.75.75 0 0 1 0 1.5H6a2.25 2.25 0 0 1-2.25-2.25v-11Zm8.22 2.72a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 1 1-1.06-1.06l1.97-1.97H8.75a.75.75 0 0 1 0-1.5h5.19l-1.97-1.97a.75.75 0 0 1 0-1.06Z"
                clip-rule="evenodd"
              /></svg
            >
            {@render tooltip("Log out")}
          </button>
        {/if}
      </div>
    </div>

    <section
      class="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/40"
    >
      <div
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:gap-y-0.5"
      >
        <div class="flex flex-wrap items-center gap-2 order-1 sm:order-none">
          {#each breadcrumbs as item, index}
            {#if index === breadcrumbs.length - 1}
              <span class="text-xs font-medium text-slate-200"
                >{item.label}</span
              >
            {:else}
              <button
                type="button"
                class="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-cyan-500 hover:text-cyan-300"
                onclick={() => navigateToDirectory(item.path)}
                >{item.label}</button
              >
              {#if item.label !== "/"}<span class="text-slate-600">/</span>{/if}
            {/if}
          {/each}
          <span class="text-slate-600">/</span>
          <input
            type="text"
            bind:value={nameFilter}
            placeholder="filter..."
            class="w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none transition focus:border-cyan-500 focus:text-cyan-300"
          />
        </div>
        <div
          class="flex flex-wrap items-center gap-3 text-sm text-slate-400 order-3 sm:order-none"
        >
          <div
            class="inline-flex rounded-xl border border-slate-700 bg-slate-950 p-1"
          >
            <button
              onclick={() => setViewMode("list")}
              type="button"
              aria-label="List view"
              title="List view"
              class="fm-view-btn {viewMode === 'list'
                ? 'bg-cyan-500 text-slate-950'
                : 'text-slate-300 transition hover:text-cyan-300'}"
            >
              <svg
                class="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M3.75 4.5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75Zm5-10a.75.75 0 0 1 .75-.75h6.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h6.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Zm0 5a.75.75 0 0 1 .75-.75h6.75a.75.75 0 0 1 0 1.5H9.5a.75.75 0 0 1-.75-.75Z"
                />
              </svg>
            </button>
            <button
              onclick={() => setViewMode("grid")}
              type="button"
              aria-label="Grid view"
              title="Grid view"
              class="fm-view-btn {viewMode === 'grid'
                ? 'bg-cyan-500 text-slate-950'
                : 'text-slate-300 transition hover:text-cyan-300'}"
            >
              <svg
                class="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M3.75 3.75A1.75 1.75 0 0 1 5.5 2h3A1.75 1.75 0 0 1 10.25 3.75v3A1.75 1.75 0 0 1 8.5 8.5h-3A1.75 1.75 0 0 1 3.75 6.75v-3Zm0 9.5A1.75 1.75 0 0 1 5.5 11.5h3a1.75 1.75 0 0 1 1.75 1.75v3A1.75 1.75 0 0 1 8.5 18h-3a1.75 1.75 0 0 1-1.75-1.75v-3ZM11.5 3.75A1.75 1.75 0 0 1 13.25 2h3A1.75 1.75 0 0 1 18 3.75v3A1.75 1.75 0 0 1 16.25 8.5h-3a1.75 1.75 0 0 1-1.75-1.75v-3Zm0 9.5a1.75 1.75 0 0 1 1.75-1.75h3A1.75 1.75 0 0 1 18 13.25v3A1.75 1.75 0 0 1 16.25 18h-3a1.75 1.75 0 0 1-1.75-1.75v-3Z"
                />
              </svg>
            </button>
          </div>
          <span>{selectedCountText}</span>
        </div>
        <div
          class="flex flex-wrap gap-2 basis-full grow-0 shrink-0 order-2 sm:order-none"
        >
          {#each availableExtensions as extension}
            <button
              type="button"
              class="fm-ext-btn {selectedExtensionsList.includes(extension)
                ? 'fm-ext-btn-on'
                : 'fm-ext-btn-off'}"
              onclick={() => toggleExtensionSelection(extension)}
              >.{extension}</button
            >
          {/each}
        </div>
      </div>

      {#if inUploadDir}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="mt-4 rounded-lg border-2 border-dashed p-6 text-center transition {dropzoneActive
            ? 'border-cyan-500 bg-cyan-500/5'
            : 'border-slate-700 bg-slate-950/60 hover:border-cyan-500 hover:bg-cyan-500/5'}"
          ondragenter={(e) => {
            e.preventDefault();
            dropzoneActive = true;
          }}
          ondragover={(e) => {
            e.preventDefault();
            dropzoneActive = true;
          }}
          ondragleave={(e) => {
            e.preventDefault();
            if (e.currentTarget === e.target) dropzoneActive = false;
          }}
          ondrop={handleDropzoneDrop}
        >
          <p class="text-lg font-medium text-slate-100">
            Drop files or folders here
          </p>
          <p class="mt-2 text-sm text-slate-400">
            Uploaded files are written to this upload directory.
          </p>
          <div class="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button
              aria-label="Upload files"
              onclick={() => {
                if (!uploadBusy) fileInputOpenToken += 1;
              }}
              disabled={uploadBusy}
              type="button"
              class="group relative inline-flex h-12 w-12 items-center justify-center rounded-lg bg-cyan-500 text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"
                ><path
                  fill-rule="evenodd"
                  d="M10 2.75a.75.75 0 0 1 .75.75v7.19l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L6.22 9.78a.75.75 0 0 1 1.06-1.06l1.97 1.97V3.5A.75.75 0 0 1 10 2.75ZM4.5 13.25A.75.75 0 0 1 5.25 14v1.5c0 .414.336.75.75.75h8a.75.75 0 0 0 .75-.75V14a.75.75 0 0 1 1.5 0v1.5A2.25 2.25 0 0 1 14 17.75H6A2.25 2.25 0 0 1 3.75 15.5V14a.75.75 0 0 1 .75-.75Z"
                  clip-rule="evenodd"
                /></svg
              >
              {@render tooltip("Upload files")}
            </button>
          </div>
          {#key fileInputVersion}
            <input
              bind:this={fileInputRef}
              type="file"
              multiple
              class="hidden"
              onchange={(e) => uploadFiles(e.currentTarget.files)}
            />
          {/key}
          {#if uploadProgressVisible}
            <div class="mx-auto mt-5 max-w-md text-left">
              <div
                class="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300"
              >
                <span>{uploadProgressLabel}</span>
                <span>{uploadProgressValue}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  style="width: {uploadProgressWidth}"
                  class="fm-progress-bar duration-150"
                ></div>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      {#if directories.length || files.length}
        <div class="mt-3 flex items-center gap-2">
          <button
            aria-label="Zip selected items"
            onclick={openCompressDialog}
            disabled={!hasSelection || zipPending || zipSizeExceeded}
            type="button"
            class="group relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-700 bg-cyan-950/30 px-3 text-xs font-medium text-cyan-200 transition hover:border-cyan-500 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
              ><path
                d="M7 2.75A1.75 1.75 0 0 0 5.25 4.5v11A1.75 1.75 0 0 0 7 17.25h6A1.75 1.75 0 0 0 14.75 15.5v-7a.75.75 0 0 0-.22-.53l-3-3A.75.75 0 0 0 11 4.75H7Z"
              /></svg
            >
            Zip
          </button>
          {#if zipSizeExceeded}
            <span class="text-xs text-rose-400">
              Selected exceeds {formatBytes(maxZipSize)} limit
            </span>
          {/if}
          {#if inUploadDir}
            <button
              aria-label="Delete selected items"
              onclick={deleteSelectedFiles}
              disabled={!hasSelection || deletePending}
              type="button"
              class="group relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-800 bg-rose-950/30 px-3 text-xs font-medium text-rose-200 transition hover:border-rose-500 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
                ><path
                  fill-rule="evenodd"
                  d="M8.75 2.75a1.75 1.75 0 0 0-1.67 1.23L6.89 4.5H4.5a.75.75 0 0 0 0 1.5h.44l.83 9.12A2.25 2.25 0 0 0 8.01 17.25h3.98a2.25 2.25 0 0 0 2.24-2.13l.83-9.12h.44a.75.75 0 0 0 0-1.5h-2.39l-.19-.52a1.75 1.75 0 0 0-1.67-1.23h-2.5Z"
                  clip-rule="evenodd"
                /></svg
              >
              Delete
            </button>
          {/if}
          {#if inUploadDir}
            <button
              aria-label="Create folder"
              onclick={openCreateFolderDialog}
              disabled={uploadBusy || createFolderPending}
              type="button"
              class="group relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-800 bg-emerald-950/30 px-3 text-xs font-medium text-emerald-200 transition hover:border-emerald-500 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
                ><path
                  d="M2.75 5A2.25 2.25 0 0 1 5 2.75h3.19c.497 0 .974.198 1.326.549l1.185 1.186c.07.07.166.109.265.109H15A2.25 2.25 0 0 1 17.25 6.75v7.5A2.25 2.25 0 0 1 15 16.5H5a2.25 2.25 0 0 1-2.25-2.25V5Zm9 2.25a.75.75 0 0 0-1.5 0v1.5h-1.5a.75.75 0 0 0 0 1.5h1.5v1.5a.75.75 0 0 0 1.5 0v-1.5h1.5a.75.75 0 0 0 0-1.5h-1.5v-1.5Z"
                /></svg
              >
              Create folder
            </button>
          {/if}
          <button
            aria-label="Refresh"
            onclick={() => loadFiles()}
            type="button"
            class="group relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300"
          >
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
              ><path
                fill-rule="evenodd"
                d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.388A5.5 5.5 0 0 1 13.89 6.11l.312.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z"
                clip-rule="evenodd"
              /></svg
            >
            {@render tooltip("Refresh")}
          </button>
        </div>
      {/if}

      {#if loading && directories.length === 0 && files.length === 0}
        <div class="mt-6 flex items-center justify-center py-20">
          <div class="relative h-24 w-24">
            <span
              class="absolute left-0 top-0 text-4xl opacity-60"
              style="animation: float1 2s ease-in-out infinite">&#128193;</span
            >
            <span
              class="absolute right-0 top-4 text-3xl opacity-40"
              style="animation: float2 2.5s ease-in-out infinite 0.3s"
              >&#128196;</span
            >
            <span
              class="absolute bottom-0 left-4 text-2xl opacity-30"
              style="animation: float3 3s ease-in-out infinite 0.6s"
              >&#128194;</span
            >
          </div>
        </div>
      {:else if !loading && directories.length === 0 && files.length === 0}
        <div class="mt-6">No items in this directory.</div>
      {:else if statusText}
        <div class="mt-6 text-sm text-slate-400">{statusText}</div>
      {/if}

      {#if viewMode === "list" && (directories.length || files.length)}
        <div class="mt-6 space-y-6">
          {#if directories.length}
            <div>
              <div class="mb-2 flex items-center gap-1">
                <input
                  bind:this={foldersHeaderCheckboxRef}
                  class="fm-check"
                  type="checkbox"
                  checked={directoriesAllSelected}
                  onchange={(e) =>
                    toggleSelectAllDirectories(e.currentTarget.checked)}
                />
                <p
                  class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
                >
                  Folders
                </p>
              </div>
              <div class="space-y-3">
                {#each directories as directory (directory.path)}
                  <div
                    class="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-900/50 px-4 py-3 transition hover:border-cyan-500 hover:bg-slate-900"
                  >
                    <input
                      class="fm-check"
                      type="checkbox"
                      checked={ui.selectedFiles.has(directory.path)}
                      onchange={(e) =>
                        setFileSelection(
                          directory.path,
                          e.currentTarget.checked,
                        )}
                    />
                    <button
                      type="button"
                      class="flex min-w-0 flex-1 items-center justify-between text-left"
                      onclick={() => navigateToDirectory(directory.path)}
                    >
                      <span class="min-w-0 truncate font-semibold text-cyan-300"
                        >{directory.name}/</span
                      >
                      <span class="text-xs text-slate-500">Folder</span>
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if files.length}
            <div>
              <div class="mb-2 flex items-center gap-2">
                <input
                  bind:this={filesHeaderCheckboxRef}
                  class="fm-check"
                  type="checkbox"
                  checked={filesAllSelected}
                  onchange={(e) =>
                    toggleSelectAllFiles(e.currentTarget.checked)}
                />
                <p
                  class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
                >
                  Files
                </p>
              </div>
              <div class="space-y-3">
                {#each files as file (file.path)}
                  <label
                    class="flex flex-wrap items-center gap-3 rounded-md border border-slate-800 bg-slate-900/30 px-4 py-3 hover:bg-slate-900/60"
                  >
                    <input
                      class="fm-check"
                      type="checkbox"
                      checked={ui.selectedFiles.has(file.path)}
                      onchange={(e) =>
                        setFileSelection(file.path, e.currentTarget.checked)}
                    />
                    <a
                      class="min-w-0 flex-1 truncate text-slate-100 underline-offset-4 hover:text-cyan-300 hover:underline"
                      href={getDownloadUrl(file.path)}>{file.name}</a
                    >
                    <span
                      class="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400"
                      >.{file.extension || "none"}</span
                    >
                    <span class="text-xs text-slate-400"
                      >{formatBytes(file.size)}</span
                    >
                    <span class="text-xs text-slate-500"
                      >{formatDateTime(file.modifiedAt)}</span
                    >
                  </label>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}

      {#if viewMode === "grid" && (directories.length || files.length)}
        <div class="mt-6 space-y-6">
          {#if directories.length}
            <div>
              <div class="mb-3 flex items-center gap-2">
                <input
                  bind:this={foldersHeaderCheckboxRef}
                  class="fm-check"
                  type="checkbox"
                  checked={directoriesAllSelected}
                  onchange={(e) =>
                    toggleSelectAllDirectories(e.currentTarget.checked)}
                />
                <p
                  class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
                >
                  Folders
                </p>
              </div>
              <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {#each directories as directory (directory.path)}
                  <div class="relative">
                    <input
                      class="absolute left-3 top-3 z-10 fm-check"
                      type="checkbox"
                      checked={ui.selectedFiles.has(directory.path)}
                      onchange={(e) =>
                        setFileSelection(
                          directory.path,
                          e.currentTarget.checked,
                        )}
                    />
                    <button
                      type="button"
                      class="flex min-h-28 w-full flex-col justify-between rounded-lg border border-slate-800 bg-slate-900/50 p-4 pl-10 text-left transition hover:border-cyan-500 hover:bg-slate-900"
                      onclick={() => navigateToDirectory(directory.path)}
                    >
                      <span class="text-3xl">&#128193;</span>
                      <div>
                        <p class="truncate font-semibold text-cyan-300">
                          {directory.name}
                        </p>
                      </div>
                    </button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if files.length}
            <div>
              <div class="mb-3 flex items-center gap-2">
                <input
                  bind:this={filesHeaderCheckboxRef}
                  class="fm-check"
                  type="checkbox"
                  checked={filesAllSelected}
                  onchange={(e) =>
                    toggleSelectAllFiles(e.currentTarget.checked)}
                />
                <p
                  class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
                >
                  Files
                </p>
              </div>
              <div
                class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
              >
                {#each files as file (file.path)}
                  <label
                    class="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 transition hover:border-cyan-500 hover:bg-slate-900/70"
                  >
                    <div class="group relative">
                      <div class="aspect-[4/3] bg-slate-950">
                        {#if isImageFile(file.extension) && thumbnailSupportedExtensions.includes(file.extension)}
                          <img
                            class="h-full w-full object-cover"
                            src={getThumbnailUrl(file.path)}
                            alt={file.name}
                            loading="lazy"
                          />
                        {:else if isVideoFile(file.extension)}
                          {#if gridVideoReady(file)}
                            <video
                              data-video-path={file.path}
                              data-shared-video="grid"
                              class="h-full w-full object-cover"
                              src={getMediaUrl(file.path)}
                              poster={getThumbnailUrl(file.path)}
                              controls
                              playsinline
                              preload="metadata"
                              onloadedmetadata={(event) =>
                                handleSharedVideoLoadedMetadata(
                                  file.path,
                                  "grid",
                                  event.currentTarget,
                                )}
                              ontimeupdate={(event) =>
                                handleSharedVideoTimeUpdate(
                                  file.path,
                                  event.currentTarget,
                                )}
                              onplay={(event) =>
                                handleSharedVideoPlay(
                                  file.path,
                                  "grid",
                                  event.currentTarget,
                                )}
                              onpause={(event) =>
                                handleSharedVideoPause(
                                  file.path,
                                  "grid",
                                  event.currentTarget,
                                )}
                              onseeked={(event) =>
                                handleSharedVideoSeeked(
                                  file.path,
                                  event.currentTarget,
                                )}
                              onended={(event) =>
                                handleSharedVideoEnded(
                                  file.path,
                                  "grid",
                                  event.currentTarget,
                                )}
                            >
                              <track kind="captions" />
                            </video>
                          {:else}
                            <div
                              class="flex h-full flex-col items-center justify-center gap-3 p-4 text-center"
                            >
                              <p class="text-sm font-semibold text-slate-100">
                                {gridVideoProgressLabel(file)}
                              </p>
                              <div
                                class="h-2 w-full max-w-[12rem] overflow-hidden rounded-full bg-slate-800"
                              >
                                <div
                                  style="width: {gridVideoProgressWidth(file)}"
                                  class="fm-progress-bar duration-300"
                                ></div>
                              </div>
                              <p class="text-xs text-slate-400">
                                {gridVideoProgressValue(file)}
                              </p>
                              <p class="min-h-4 text-xs text-rose-300">
                                {gridVideoError(file)}
                              </p>
                            </div>
                          {/if}
                        {:else}
                          <div
                            class="flex h-full items-center justify-center text-4xl text-slate-500"
                          >
                            .{file.extension || "file"}
                          </div>
                        {/if}
                      </div>
                      {#if (isImageFile(file.extension) && file.extension !== 'pdf') || isVideoFile(file.extension)}
                        <button
                          type="button"
                          aria-label="Open media viewer"
                          class="fm-media-action"
                          onclick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openLightbox(file.path);
                          }}
                        >
                          <svg
                            class="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            ><path
                              fill-rule="evenodd"
                              d="M12.25 3.5a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75V7a.75.75 0 0 1-1.5 0V5.31l-4.22 4.22a.75.75 0 1 1-1.06-1.06l4.22-4.22H13a.75.75 0 0 1-.75-.75Zm-4.5 13a.75.75 0 0 1-.75.75H3.5a.75.75 0 0 1-.75-.75V13a.75.75 0 0 1 1.5 0v1.69l4.22-4.22a.75.75 0 0 1 1.06 1.06l-4.22 4.22H7a.75.75 0 0 1 .75.75Zm8.75-3.5a.75.75 0 0 1 .75.75v2.75a.75.75 0 0 1-.75.75h-2.75a.75.75 0 0 1 0-1.5h1.69l-4.22-4.22a.75.75 0 0 1 1.06-1.06l4.22 4.22V13.75a.75.75 0 0 1 .75-.75Zm-13-9.5a.75.75 0 0 1 .75-.75H7a.75.75 0 0 1 0 1.5H5.31l4.22 4.22a.75.75 0 1 1-1.06 1.06L4.25 5.31V7a.75.75 0 0 1-1.5 0V3.5Z"
                              clip-rule="evenodd"
                            /></svg
                          >
                        </button>
                      {:else if isZipFile(file.extension)}
                        <button
                          type="button"
                          aria-label="Open archive viewer"
                          class="fm-media-action"
                          onclick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openLightbox(file.path);
                          }}
                        >
                          <svg
                            class="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            ><path
                              fill-rule="evenodd"
                              d="M5.5 2.75A1.75 1.75 0 0 0 3.75 4.5v11c0 .966.784 1.75 1.75 1.75h9A1.75 1.75 0 0 0 16.25 15.5v-7a.75.75 0 0 0-.22-.53l-3-3a.75.75 0 0 0-.53-.22h-7Z"
                              clip-rule="evenodd"
                            /></svg
                          >
                        </button>
                      {/if}
                      <input
                        class="absolute left-3 top-3 fm-check"
                        type="checkbox"
                        checked={ui.selectedFiles.has(file.path)}
                        onchange={(e) =>
                          setFileSelection(file.path, e.currentTarget.checked)}
                      />
                    </div>
                    <div class="space-y-2 p-4">
                      <div
                        class="flex items-center gap-2"
                      >
                        {#if isVideoFile(file.extension)}
                          <button
                            type="button"
                            class="min-w-0 truncate font-semibold text-slate-100 underline-offset-4 transition hover:text-cyan-300 hover:underline"
                            onclick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openLightbox(file.path);
                            }}>{file.name}</button
                          >
                        {:else}
                          <a
                            class="min-w-0 truncate font-semibold text-slate-100 underline-offset-4 hover:text-cyan-300 hover:underline"
                            href={getDownloadUrl(file.path)}>{file.name}</a
                          >
                        {/if}
                        <span
                          class="shrink-0 rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400"
                          >.{file.extension || "none"}</span
                        >
                      </div>
                      <div
                        class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400"
                      >
                        <span>{formatBytes(file.size)}</span>
                        {#if formatImageDimensions(file)}
                          <span class="-mx-1 text-slate-600">|</span>
                          <span>{formatImageDimensions(file)}</span>
                        {/if}
                        <span class="-mx-1 text-slate-600">|</span>
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

      {#if showPagination}
      <div
        class="mt-5 flex flex-wrap items-center gap-3 text-sm text-slate-400"
      >
        <button
          aria-label="Previous page"
          onclick={() => changePageBy(-1)}
          disabled={!canGoPrev}
          type="button"
          class="group fm-page-btn"
        >
          <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"
            ><path
              fill-rule="evenodd"
              d="M11.78 4.22a.75.75 0 0 1 0 1.06L7.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06l-5.25-5.25a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z"
              clip-rule="evenodd"
            /></svg
          >
          {@render tooltip("Previous page")}
        </button>
        <span>Page</span>
        <input
          bind:value={pageInputValue}
          max={pageInputMax}
          onchange={() => {
            ui.page = Math.min(
              ui.totalPages,
              Math.max(1, Number(pageInputValue || "1")),
            );
            loadFiles();
          }}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              ui.page = Math.min(
                ui.totalPages,
                Math.max(1, Number(pageInputValue || "1")),
              );
              loadFiles();
            }
          }}
          type="number"
          min="1"
          class="w-20 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-0"
        />
        <span>of</span>
        <span class="text-slate-400">{pageInfoText}</span>
        <button
          aria-label="Next page"
          onclick={() => changePageBy(1)}
          disabled={!canGoNext}
          type="button"
          class="group fm-page-btn"
        >
          <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"
            ><path
              fill-rule="evenodd"
              d="M8.22 15.78a.75.75 0 0 1 0-1.06L12.94 10 8.22 5.28a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 0 1-1.06 0Z"
              clip-rule="evenodd"
            /></svg
          >
          {@render tooltip("Next page")}
        </button>
        <div class="flex items-center gap-2">
          <span>Page size</span>
          <div class="relative" bind:this={pageSizeContainerRef}>
            <button
              onclick={() => {
                if (!pageSizeMenuOpen && pageSizeContainerRef) {
                  const rect = pageSizeContainerRef.getBoundingClientRect();
                  pageSizeMenuLeft = rect.right + 128 > window.innerWidth;
                }
                pageSizeMenuOpen = !pageSizeMenuOpen;
              }}
              type="button"
              class="inline-flex min-w-24 items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none transition hover:border-cyan-500"
            >
              <span>{pageSizeDisplay}</span>
              <svg
                class="h-4 w-4 text-slate-500"
                viewBox="0 0 20 20"
                fill="currentColor"
                ><path
                  fill-rule="evenodd"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                  clip-rule="evenodd"
                /></svg
              >
            </button>
            {#if pageSizeMenuOpen}
              <div
                class="absolute z-20 mt-2 w-32 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur {pageSizeMenuLeft
                  ? 'left-0'
                  : 'right-0'}"
              >
                {#each pageSizeOptions as option}
                  <button
                    onclick={() => {
                      pageSizeDisplay = String(option);
                      ui.pageSize = option === "All" ? "All" : Number(option);
                      ui.page = 1;
                      pageSizeMenuOpen = false;
                      loadFiles();
                    }}
                    type="button"
                    class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition {String(
                      option,
                    ) === pageSizeDisplay
                      ? 'bg-cyan-500/15 text-cyan-200'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200'}"
                  >
                    <span>{String(option)}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
      {/if}
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
    formatArchiveBytes={formatBytes}
    formatArchiveDate={formatDateTime}
    onVideoLoadedMetadata={(event) =>
      handleSharedVideoLoadedMetadata(
        lightboxPathValue,
        "lightbox",
        event.currentTarget,
      )}
    onVideoTimeUpdate={(event) =>
      handleSharedVideoTimeUpdate(lightboxPathValue, event.currentTarget)}
    onVideoPlay={(event) =>
      handleSharedVideoPlay(lightboxPathValue, "lightbox", event.currentTarget)}
    onVideoPause={(event) =>
      handleSharedVideoPause(
        lightboxPathValue,
        "lightbox",
        event.currentTarget,
      )}
    onVideoSeeked={(event) =>
      handleSharedVideoSeeked(lightboxPathValue, event.currentTarget)}
    onVideoEnded={(event) =>
      handleSharedVideoEnded(
        lightboxPathValue,
        "lightbox",
        event.currentTarget,
      )}
    onClose={closeLightbox}
    onPrev={() => stepLightbox(-1)}
    onNext={() => stepLightbox(1)}
    onNavigateArchiveDirectory={setArchivePreviewDirectory}
    {getArchiveEntryDownloadUrl}
    onImageLoad={handleLightboxImageLoad}
    onZoomIn={() => nudgeLightboxZoom(1)}
    onZoomOut={() => nudgeLightboxZoom(-1)}
    onZoomChange={(v) => setLightboxZoom(v)}
    onToggleZoomMenu={() => {
      lightboxZoomMenuOpen = !lightboxZoomMenuOpen;
    }}
    onPointerDown={startLightboxPan}
    onPointerMove={moveLightboxPan}
    onPointerUp={endLightboxPan}
    onTouchStart={handleLightboxPinchStart}
    onTouchMove={handleLightboxPinchMove}
    onTouchEnd={handleLightboxPinchEnd}
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
      if (!uploadConflictFileName.trim()) {
        uploadConflictDialogErrorText = "Filename is required.";
        return;
      }
      closeUploadConflictDialog({
        action: "rename",
        fileName: uploadConflictFileName,
      });
    }}
    onOverwrite={() => closeUploadConflictDialog({ action: "overwrite" })}
    onCancel={() => closeUploadConflictDialog({ action: "cancel" })}
  />
{/if}

{#if createFolderDialogOpen}
  <CreateFolderDialog
    title={createFolderDialogTitleText}
    message={createFolderDialogMessageText}
    bind:folderName={createFolderDialogName}
    errorText={createFolderDialogErrorText}
    pending={createFolderPending}
    onCreate={createFolder}
    onCancel={closeCreateFolderDialog}
  />
{/if}

{#if compressDialogOpen}
  <CompressDialog
    title="Zip selected items"
    message="Enter a filename for the zip archive."
    bind:fileName={compressDialogFileName}
    errorText={compressDialogErrorText}
    pending={zipPending}
    bind:progress={compressDialogProgress}
    imageInfo={commonImageInfo}
    imageExtension={commonImageExtension}
    bind:resizeWidth={compressDialogResizeWidth}
    bind:resizeHeight={compressDialogResizeHeight}
    bind:resizeQuality={compressDialogResizeQuality}
    bind:imageFormat={compressDialogImageFormat}
    fileCount={selectedFileCount}
    dirCount={selectedDirCount}
    totalSize={compressDialogTotalSize}
    formatBytes={formatBytes}
    onCompress={handleCompress}
    onCancel={closeCompressDialog}
  />
{/if}
