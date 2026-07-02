<script lang="ts">
  import Login from "./Login.svelte";
  import Lightbox from "./Lightbox.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import CreateFolderDialog from "./CreateFolderDialog.svelte";
  import CompressDialog from "./CompressDialog.svelte";
  import TagsDialog from "./TagsDialog.svelte";
  import UploadConflictDialog from "./UploadConflictDialog.svelte";
  import {
    applyListingResponse,
    buildFilesQuery,
    movePage,
    toggleRequestedExtension,
    type BreadcrumbItem,
    type FileListingResponse,
  } from "./file-manager/file-listing";
  import {
    buildArchiveLightboxMetaItems,
    buildArchivePreviewState,
    buildLightboxZoomOptions,
    buildMediaLightboxMetaItems,
    getCurrentLightboxZoomPercent,
    type LightboxMetaItem,
    type ZoomOption,
  } from "./file-manager/lightbox-state";
  import {
    createSharedVideoController,
    type SharedVideoPlaybackEntry,
  } from "./file-manager/shared-video";
  import {
    areAllItemsSelected,
    areSomeItemsSelected,
    countSelectedItems,
    getCommonImageExtension,
    getCommonImageInfo,
    getSelectedTotalSize,
    setSelectedFilePath,
    setSelectedPaths,
    summarizeSelection,
  } from "./file-manager/selection-state";
  import {
    createUploadCompleteStatus,
    createUploadProgressState,
    createUploadStartStatus,
    getTotalUploadBytes,
    uploadCandidateWithXhr,
  } from "./file-manager/upload-flow";
  import {
    createVideoPreparationErrorEntry,
    getDefaultVideoPreparationEntry,
    getVideoPreparationProgress,
    normalizeVideoPreparationResponse,
    videoRequiresPreparation,
    type VideoPreparationEntry,
  } from "./file-manager/video-preparation";
  import {
    clearSession,
    createTokenizedFileUrl,
    getAuthHeaders,
    readSession,
    touchSession,
    writeSession,
    type ClientSession,
  } from "./file-manager/client-auth";
  import {
    createUploadCandidatesFromFileList,
    getDropUploadCandidates,
    isWithinConfiguredUploadDir,
    normalizeClientRelativeDirectory,
    type UploadCandidate,
  } from "./file-manager/client-paths";
  import { Toaster, toast } from "svelte-sonner";
  import { formatBytes, formatDateTime } from "./file-manager/formatters";
  import { tagFilterButtonClass, tagChipClass } from "./file-manager/tag-colors";
  import {
    readInitialLocationState as readInitialLocationStateFromUrl,
    syncLocationState as syncLocationStateToUrl,
  } from "./file-manager/location-state";

  interface Props {
    auth: { enabled: boolean; sessionExpiryMs: number; username: string };
    uploadDir: string;
    maxZipSize: number;
    imageExtensions: string[];
    videoExtensions: string[];
    thumbnailSupportedExtensions: string[];
    lightboxLoadDebounceMs: number;
    pageLoadDebounceMs: number;
  }

  let {
    auth,
    uploadDir,
    maxZipSize,
    imageExtensions,
    videoExtensions,
    thumbnailSupportedExtensions,
    lightboxLoadDebounceMs,
    pageLoadDebounceMs,
  }: Props = $props();

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
  let loading = $state(false);
  let pageInfoText = $state("");
  let pageInputValue = $state("1");
  let pageInputMax = $state("1");
  let totalItems = $state(0);
  let pageSizeOptions: (number | string)[] = $state([]);
  let showPagination = $derived(totalItems >= (Math.min(...pageSizeOptions.filter((n): n is number => typeof n === 'number')) || 10));
  let pageSizeMenuOpen = $state(false);
  let pageSizeMenuLeft = $state(false);
  let kebabMenuOpenPath: string | null = $state(null);
  let pageSizeDisplay = $state("20");
  let viewMode = $state<"list" | "grid">("grid");
  let breadcrumbs: BreadcrumbItem[] = $state([
    { label: "/", path: "" },
  ]);
  let availableExtensions: string[] = $state([]);
  let selectedExtensionsList: string[] = $state([]);
  let availableTags: string[] = $state([]);
  let selectedTagsList: string[] = $state([]);
  let nameFilter = $state("");
  let directories: { name: string; path: string; tags?: string[] }[] = $state([]);
  let files: any[] = $state([]);
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
  const sharedVideo = createSharedVideoController();

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

  let tagsDialogOpen = $state(false);
  let tagsDialogSelectedItems: string[] = $state([]);
  let tagsDialogSelectedItemNames: string[] = $state([]);

  let compressDialogOpen = $state(false);
  let compressDialogFileName = $state("download.zip");
  let compressDialogErrorText = $state("");
  let compressDialogTotalSize = $state(0);
  let compressDialogResizeWidth = $state(0);
  let compressDialogResizeHeight = $state(0);
  let compressDialogRotation = $state(0);
  let compressDialogResizeQuality = $state(100);
  let compressDialogImageFormat = $state("jpeg");
  let compressDialogProgress = $state<number | null>(null);
  let processDialogOpen = $state(false);
  let processDialogFileName = $state("");
  let processDialogErrorText = $state("");
  let processDialogResizeWidth = $state(0);
  let processDialogResizeHeight = $state(0);
  let processDialogRotation = $state(0);
  let processDialogResizeQuality = $state(100);
  let processDialogImageFormat = $state("jpeg");
  let processPending = $state(false);
  let prevProcessDialogImageFormat = $state("jpeg");

  let lightboxOpen = $state(false);
  let lightboxMode = $state("");
  let lightboxPathValue = $state("");
  let lightboxImageUrl = $state("");
  let lightboxImageError = $state(false);
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
  let lightboxMetaItems: LightboxMetaItem[] = $state([]);
  let lightboxPrevDisabled = $state(false);
  let lightboxNextDisabled = $state(false);
  let lightboxZoomValue = $state("fit");
  let lightboxZoomMenuOpen = $state(false);
  let lightboxDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let pageLoadDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  let lightboxZoomInDisabled = $state(false);
  let lightboxZoomOutDisabled = $state(true);
  let lightboxCanPan = $state(false);
  let lightboxDragging = $state(false);
  let lightboxImageStyle: Record<string, string> = $state({});
  let lightboxZoomOptions: ZoomOption[] = $state([]);
  let lightboxZoomLabel = $state("Fit");

  const ui = $state({
    page: 1,
    pageSize: 20 as number | string,
    totalPages: 1,
    currentDir: "",
    selectedFiles: new Set<string>(),
    requestedExtensions: new Set<string>(),
    selectedExtensions: new Set<string>(),
    requestedTags: new Set<string>(),
    untagged: false,
    tagged: false,
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
    tagIndexMap: {} as Record<string, number>,
  });

  const selectedTotalSize = $derived(
    getSelectedTotalSize(ui.selectedFiles, files),
  );
  const directoriesAllSelected = $derived(
    areAllItemsSelected(ui.selectedFiles, directories),
  );
  const directoriesSomeSelected = $derived(
    areSomeItemsSelected(ui.selectedFiles, directories),
  );
  const filesAllSelected = $derived(
    areAllItemsSelected(ui.selectedFiles, files),
  );
  const filesSomeSelected = $derived(
    areSomeItemsSelected(ui.selectedFiles, files),
  );
  const zipSizeExceeded = $derived(selectedTotalSize > maxZipSize);
  const commonImageInfo = $derived.by(() => {
    return getCommonImageInfo(ui.selectedFiles, files, isImageFile);
  });
  const commonImageExtension = $derived.by(() => {
    return getCommonImageExtension(ui.selectedFiles, files, isImageFile);
  });
  const processImageInfo = $derived.by(() => {
    if (!processDialogOpen) return null;
    const file = getSelectedSingleFile();
    return file && isImageFile(file.extension)
      ? getCommonImageInfo(new Set([file.path]), files, isImageFile)
      : null;
  });
  const processImageExtension = $derived.by(() => {
    if (!processDialogOpen) return null;
    const file = getSelectedSingleFile();
    return file && isImageFile(file.extension)
      ? getCommonImageExtension(new Set([file.path]), files, isImageFile)
      : null;
  });
  const processDialogTotalSize = $derived.by(() => {
    const file = getSelectedSingleFile();
    return processDialogOpen && file ? Number(file.size) || 0 : 0;
  });
  const selectedDirCount = $derived(
    countSelectedItems(ui.selectedFiles, directories),
  );
  const selectedFileCount = $derived(
    countSelectedItems(ui.selectedFiles, files),
  );

  const inUploadDir = $derived(
    isWithinConfiguredUploadDir(ui.currentDir, uploadDir),
  );

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

  let pendingInitialLightboxPath = "";

  function readInitialLocationState() {
    return readInitialLocationStateFromUrl(normalizeLightboxZoomValue);
  }

  function syncLocationState() {
    syncLocationStateToUrl({
      currentDir: ui.currentDir,
      page: ui.page,
      pageSize: ui.pageSize,
      nameFilter,
      requestedExtensions: ui.requestedExtensions,
      requestedTags: ui.requestedTags,
      untagged: ui.untagged,
      tagged: ui.tagged,
      lightboxOpen,
      lightboxPath: ui.lightboxPath,
      lightboxMode,
      lightboxZoomValue,
    });
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

  function getProcessOutputExtension(imageFormat: string): string {
    return imageFormat === "png" ? "png" : "jpg";
  }

  function buildProcessFileName(
    fileName: string,
    imageFormat: string,
    fallbackName = "image",
  ): string {
    const trimmed = fileName.trim();
    const safeName = trimmed || fallbackName;
    const baseName = safeName.replace(/\.[^/.]+$/, "") || fallbackName;
    return `${baseName}.${getProcessOutputExtension(imageFormat)}`;
  }

  function isProcessableImagePath(filePath: string): boolean {
    const file = files.find((entry: any) => entry.path === filePath);
    return !!file && isImageFile(file.extension);
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

  function getCurrentSession(): ClientSession | null {
    return readSession({
      authEnabled,
      authUsername,
      sessionExpiryMs,
    });
  }

  function updateSessionInfo() {
    if (!authEnabled) {
      sessionInfoText = "Authentication disabled";
      return;
    }
    const session = getCurrentSession();
    if (!session) {
      sessionInfoText = "Session expired";
      return;
    }
    sessionInfoText = session.username;
  }

  function forceLogout(message = "Session ended. Please log in again.") {
    if (!authEnabled) {
      toast.error(message);
      showApp();
      return;
    }
    clearSession();
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
      writeSession(loginUsername, data.token, sessionExpiryMs);
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
      await fetch("/api/logout", {
        method: "POST",
        headers: getAuthHeaders(getCurrentSession()),
      });
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
    if (!getCurrentSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    updateSessionInfo();
    ui.selectedFiles = new Set();
    loading = true;
    const requestId = ++loadFilesRequestId;
    try {
      const query = buildFilesQuery({
        currentDir: ui.currentDir,
        page: ui.page,
        pageSize: ui.pageSize,
        viewMode,
        nameFilter,
        requestedExtensions: ui.requestedExtensions,
        requestedTags: ui.requestedTags,
        untagged: ui.untagged,
        tagged: ui.tagged,
      });

      const response = await fetch("/api/files?" + query.toString(), {
        headers: getAuthHeaders(getCurrentSession()),
      });
      if (requestId !== loadFilesRequestId) return;

      if (response.status === 401) {
        forceLogout("Session expired: please log in again");
        return;
      }

      const data = (await response.json().catch(() => ({}))) as Partial<
        FileListingResponse
      > & { error?: string };
      if (requestId !== loadFilesRequestId) return;

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load files");
      }

      touchSession();

      const nextListing = applyListingResponse({
        data: data as FileListingResponse,
        requestedExtensionsSize: ui.requestedExtensions.size,
        isImageFile,
        isVideoFile,
        formatBytes,
      });

      if (nextListing.requestedExtensionsCleared) {
        ui.requestedExtensions.clear();
        ui.selectedExtensions.clear();
        selectedExtensionsList = [];
      }
      availableExtensions = nextListing.availableExtensions;
      availableTags = nextListing.availableTags;
      selectedTagsList = nextListing.selectedTags;
      totalItems = nextListing.totalItems;
      pageSizeOptions = nextListing.pageSizeOptions;
      ui.page = nextListing.page;
      ui.totalPages = nextListing.totalPages;
      ui.currentDir = nextListing.currentDir;
      ui.visibleMediaFiles = nextListing.visibleMediaFiles;
      ui.totalMedia = nextListing.totalMedia;
      ui.mediaOffset = nextListing.mediaOffset;
      directories = nextListing.directories;
      files = nextListing.files;
      ui.tagIndexMap = nextListing.tagIndexMap;
      pageInfoText = nextListing.pageInfoText;
      pageInputValue = nextListing.pageInputValue;
      pageInputMax = nextListing.pageInputMax;
      pageSizeDisplay = nextListing.pageSizeDisplay;
      pageSizeMenuOpen = false;
      canGoPrev = nextListing.canGoPrev;
      canGoNext = nextListing.canGoNext;
      breadcrumbs = nextListing.breadcrumbs;
      summaryFolderText = nextListing.summaryFolderText;
      summaryFileText = nextListing.summaryFileText;
      totalSizeText = nextListing.totalSizeText;
      updateSelectedCount();
      if (!nextListing.directories.length && !nextListing.files.length) {
        toast.info("No items found.");
      }
      syncLocationState();
    } catch (error) {
      if (requestId !== loadFilesRequestId) return;
      toast.error(
        error instanceof Error ? error.message : "Failed to load files",
      );
    } finally {
      if (requestId === loadFilesRequestId) {
        loading = false;
      }
    }
  }

  function updateSelectedCount() {
    const summary = summarizeSelection(ui.selectedFiles);
    selectedCountText = summary.selectedCountText;
    selectedFilePaths = summary.selectedFilePaths;
    hasSelection = summary.hasSelection;
  }

  function setFileSelection(filePath: string, checked: boolean) {
    ui.selectedFiles = setSelectedFilePath(ui.selectedFiles, filePath, checked);
    updateSelectedCount();
  }

  function toggleSelectAllDirectories(checked: boolean) {
    ui.selectedFiles = setSelectedPaths(ui.selectedFiles, directories, checked);
    updateSelectedCount();
  }

  function toggleSelectAllFiles(checked: boolean) {
    ui.selectedFiles = setSelectedPaths(ui.selectedFiles, files, checked);
    updateSelectedCount();
  }

  async function toggleExtensionSelection(extension: string) {
    selectedExtensionsList = toggleRequestedExtension(
      ui.requestedExtensions,
      ui.selectedExtensions,
      extension,
    );
    ui.page = 1;
    try {
      await loadFiles();
      syncLocationState();
    } catch {}
  }

  function toggleTag(tag: string) {
    if (ui.requestedTags.has(tag)) {
      ui.requestedTags.delete(tag);
    } else {
      ui.requestedTags.add(tag);
      ui.untagged = false;
      ui.tagged = false;
    }
    selectedTagsList = [...ui.requestedTags].sort();
    ui.page = 1;
    loadFiles();
  }

  async function navigateToDirectory(relativePath: string) {
    if (!getCurrentSession()) {
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
    const nextPage = movePage(ui.page, ui.totalPages, delta);
    if (nextPage === null) return;
    ui.page = nextPage;
    schedulePageLoad();
  }

  function setViewMode(mode: "list" | "grid") {
    viewMode = mode;
    ui.page = 1;
    loadFiles();
  }

  function getMediaUrl(filePath: string): string {
    return createTokenizedFileUrl(
      "/media",
      filePath,
      getCurrentSession(),
      authEnabled,
    );
  }

  function getThumbnailUrl(filePath: string): string {
    return createTokenizedFileUrl(
      "/thumbnail",
      filePath,
      getCurrentSession(),
      authEnabled,
    );
  }

  function getDownloadUrl(filePath: string): string {
    return createTokenizedFileUrl(
      "/download",
      filePath,
      getCurrentSession(),
      authEnabled,
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

    return getDefaultVideoPreparationEntry(extension, isVideoFile);
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

    const progress = getVideoPreparationProgress(entry);
    lightboxVideoProgressLabel = progress.label;
    lightboxVideoProgressValue = progress.value;
    lightboxVideoProgressWidth = progress.width;
    lightboxVideoErrorText = progress.error;

    if (entry.ready) {
      lightboxVideoUrl = getMediaUrl(filePath);
      lightboxVideoReady = true;
      window.requestAnimationFrame(() => {
        if (lightboxPathValue !== filePath || !lightboxOpen) {
          return;
        }

        sharedVideo.syncSurface(filePath, "lightbox");
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
        headers: getAuthHeaders(getCurrentSession()),
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

        updateVideoPreparation(
          file.path,
          file.extension,
          normalizeVideoPreparationResponse(data),
        );

        if (data.ready || data.error) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } catch (error) {
      updateVideoPreparation(
        file.path,
        file.extension,
        createVideoPreparationErrorEntry(error),
      );
    } finally {
      activeVideoPreparationPolls.delete(file.path);
    }
  }

  async function uploadFiles(uploadInput: FileList | UploadCandidate[] | null) {
    if (!getCurrentSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    if (ui.isUploading) return;

    const uploadCandidates = Array.isArray(uploadInput)
      ? uploadInput
      : createUploadCandidatesFromFileList(uploadInput);

    if (!uploadCandidates.length) {
      toast.info("No files found to upload.");
      return;
    }

    const totalUploadBytes = getTotalUploadBytes(uploadCandidates);
    ui.isUploading = true;
    uploadBusy = true;
    uploadProgressVisible = true;
    toast.info(createUploadStartStatus(uploadCandidates.length));

    let uploadedBytes = 0;
    const uploadedNames: string[] = [];

    try {
      for (const entry of uploadCandidates) {
        const uploaded = await uploadCandidateWithXhr({
          candidate: entry,
          currentDir: ui.currentDir,
          authHeaders: getAuthHeaders(getCurrentSession()),
          onProgress: (loadedBytes) => {
            const progress = createUploadProgressState({
              uploadedBytes,
              loadedBytes,
              totalUploadBytes,
              uploadCount: uploadCandidates.length,
              formatBytes,
            });
            uploadProgressWidth = progress.width;
            uploadProgressValue = progress.value;
            uploadProgressLabel = progress.label;
          },
        });
        uploadedBytes += entry.file.size;
        uploadedNames.push(...uploaded);
      }

      fileInputVersion += 1;
      await loadFiles();
      toast.success(createUploadCompleteStatus(uploadedNames));
    } catch (error: any) {
      if (error.message === "Session expired") {
        forceLogout("Session expired: please log in again");
        return;
      }
      toast.error(error.message || "Upload failed.");
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

  let savedSelectionBeforeKebab: Set<string> | null = null;

  function saveAndSetSelection(path: string) {
    savedSelectionBeforeKebab = new Set(ui.selectedFiles);
    ui.selectedFiles = new Set([path]);
    updateSelectedCount();
  }

  function restoreSelectionAfterKebab(): boolean {
    if (savedSelectionBeforeKebab) {
      ui.selectedFiles = savedSelectionBeforeKebab;
      savedSelectionBeforeKebab = null;
      updateSelectedCount();
      return true;
    }
    return false;
  }

  function handleKebabZip(path: string) {
    saveAndSetSelection(path);
    openCompressDialog();
  }

  function handleKebabProcess(path: string) {
    saveAndSetSelection(path);
    openProcessDialog();
  }

  function handleKebabTags(path: string) {
    saveAndSetSelection(path);
    openTagsDialog();
  }

  function getSelectedSingleFile() {
    if (ui.selectedFiles.size !== 1) return null;
    const selectedPath = [...ui.selectedFiles][0];
    return files.find((file: any) => file.path === selectedPath) ?? null;
  }

  async function openCompressDialog() {
    if (!getCurrentSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    if (!ui.selectedFiles.size) {
      toast.info("Select at least one file first");
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
    compressDialogRotation = 0;
    compressDialogImageFormat = commonImageExtension === "png" ? "png" : "jpeg";
    if (ui.selectedFiles.size > 0) {
      try {
        const query = new URLSearchParams({ dir: ui.currentDir });
        const response = await fetch("/api/selection-size?" + query.toString(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...getAuthHeaders(getCurrentSession()),
          },
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

  function openProcessDialog() {
    if (!getCurrentSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    const selectedFile = getSelectedSingleFile();
    if (!selectedFile || !isImageFile(selectedFile.extension)) {
      toast.info("Select a single image file first");
      return;
    }
    processDialogFileName = buildProcessFileName(
      selectedFile.name,
      selectedFile.extension === "png" ? "png" : "jpeg",
      selectedFile.name.replace(/\.[^/.]+$/, "") || "image",
    );
    processDialogErrorText = "";
    processDialogResizeWidth = selectedFile.width || 0;
    processDialogResizeHeight = selectedFile.height || 0;
    processDialogRotation = 0;
    processDialogResizeQuality = 100;
    processDialogImageFormat = selectedFile.extension === "png" ? "png" : "jpeg";
    prevProcessDialogImageFormat = processDialogImageFormat;
    processDialogOpen = true;
  }

  function openTagsDialog() {
    if (!ui.selectedFiles.size) {
      toast.info("Select at least one item first");
      return;
    }
    tagsDialogSelectedItems = [...ui.selectedFiles];
    tagsDialogSelectedItemNames = tagsDialogSelectedItems.map((path) => {
      const item = [...directories, ...files].find((i: any) => i.path === path);
      return item?.name ?? path.split("/").pop() ?? path;
    });
    tagsDialogOpen = true;
  }

  async function closeTagsDialog() {
    tagsDialogOpen = false;
    tagsDialogSelectedItems = [];
    tagsDialogSelectedItemNames = [];
    await loadFiles();
    restoreSelectionAfterKebab();
  }

  function closeCompressDialog() {
    if (zipPending) return;
    compressDialogOpen = false;
    compressDialogFileName = "download.zip";
    compressDialogErrorText = "";
    compressDialogRotation = 0;
    restoreSelectionAfterKebab();
  }

  function closeProcessDialog() {
    if (processPending) return;
    processDialogOpen = false;
    processDialogFileName = "";
    processDialogErrorText = "";
    processDialogRotation = 0;
    prevProcessDialogImageFormat = "jpeg";
    restoreSelectionAfterKebab();
  }

  async function handleCompress() {
    if (!getCurrentSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    if (!ui.selectedFiles.size) {
      toast.info("Select at least one file first");
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
      body.rotation = compressDialogRotation;
      body.resizeQuality = compressDialogResizeQuality;
      body.imageFormat = compressDialogImageFormat;
    }
    const response = await fetch("/api/zip-selection?" + query.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getAuthHeaders(getCurrentSession()),
      },
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
        if (!restoreSelectionAfterKebab()) {
          ui.selectedFiles = new Set();
          updateSelectedCount();
        }
        toast.success("Downloaded zip: " + zipFilename);
      } else {
        compressDialogErrorText = "Failed to create zip file";
      }
    } catch {
      zipPending = false;
      compressDialogProgress = null;
      compressDialogErrorText = "Failed to create zip file";
    }
  }

  async function handleProcessImage() {
    if (!getCurrentSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    const selectedFile = getSelectedSingleFile();
    if (!selectedFile || !isImageFile(selectedFile.extension)) {
      processDialogErrorText = "Select a single image file first";
      return;
    }

    processPending = true;
    processDialogErrorText = "";
    const query = new URLSearchParams({ dir: ui.currentDir });
    const response = await fetch("/api/process-image?" + query.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getAuthHeaders(getCurrentSession()),
      },
      body: JSON.stringify({
        item: selectedFile.path,
        filename: processDialogFileName.trim(),
        resizeWidth: processDialogResizeWidth,
        resizeHeight: processDialogResizeHeight,
        rotation: processDialogRotation,
        resizeQuality: processDialogResizeQuality,
        imageFormat: processDialogImageFormat,
      }),
    });

    if (!response.ok) {
      processPending = false;
      const data = await response.json().catch(() => ({}));
      processDialogErrorText = data.error ?? "Failed to process image";
      return;
    }

    const data = await response.json().catch(() => ({}));
    processPending = false;
    if (!data.token) {
      processDialogErrorText = "Processed download was not created";
      return;
    }

    const link = document.createElement("a");
    link.href = `/api/process-image-download?token=${encodeURIComponent(data.token)}`;
    link.click();
    processDialogOpen = false;
    restoreSelectionAfterKebab();
  }

  $effect(() => {
    if (!processDialogOpen) return;
    if (prevProcessDialogImageFormat === processDialogImageFormat) return;
    const selectedFile = getSelectedSingleFile();
    const fallbackName = selectedFile?.name.replace(/\.[^/.]+$/, "") || "image";
    processDialogFileName = buildProcessFileName(
      processDialogFileName,
      processDialogImageFormat,
      fallbackName,
    );
    prevProcessDialogImageFormat = processDialogImageFormat;
  });

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
    if (!getCurrentSession()) {
      forceLogout("Session expired: please log in again");
      return;
    }
    if (!ui.selectedFiles.size) {
      toast.info("Select at least one file first");
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
    toast.info("Deleting selected items...");
    const query = new URLSearchParams({ dir: ui.currentDir });
    const response = await fetch("/api/delete-selection?" + query.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...getAuthHeaders(getCurrentSession()),
      },
      body: JSON.stringify({ items: [...ui.selectedFiles] }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      deletePending = false;
      toast.error(data.error ?? "Failed to delete selected files");
      return;
    }
    ui.selectedFiles = new Set();
    updateSelectedCount();
    deletePending = false;
    toast.success("Deleted " + data.deleted.length + " item(s)");
    await loadFiles();
  }

  async function createFolder() {
    if (!getCurrentSession()) {
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
    toast.info('Creating folder "' + trimmedFolderName + '"...');

    try {
      const query = new URLSearchParams({ dir: ui.currentDir });
      const response = await fetch("/api/create_folder?" + query.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...getAuthHeaders(getCurrentSession()),
        },
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
      toast.success('Created folder "' + trimmedFolderName + '"');
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
      sharedVideo.handoffToSurface(filePath, "lightbox", true);
    }
    syncLightboxState();
    syncLocationState();
  }

  function closeLightbox() {
    if (lightboxDebounceTimer) {
      clearTimeout(lightboxDebounceTimer);
      lightboxDebounceTimer = undefined;
    }
    const closingLightboxPath = lightboxPathValue;
    const lightboxVideo = sharedVideo.getElementsByPath(
      closingLightboxPath,
    ).find((element) => sharedVideo.getElementSurface(element) === "lightbox");
    const shouldRestoreGridVideo =
      lightboxMode === "video" && Boolean(closingLightboxPath && lightboxVideo);

    if (shouldRestoreGridVideo && lightboxVideo) {
      sharedVideo.storePlayback(closingLightboxPath, lightboxVideo, {
        preferredSurface: "grid",
        shouldResume: sharedVideo.isPlaybackActive(lightboxVideo),
      });
      sharedVideo.pauseElement(lightboxVideo);
    }

    ui.lightboxIndex = -1;
    ui.lightboxPath = "";
    ui.lightboxLoadToken += 1;
    lightboxOpen = false;
    lightboxMode = "";
    lightboxPathValue = "";
    lightboxImageUrl = "";
    lightboxImageError = false;
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
        sharedVideo.syncSurface(closingLightboxPath, "grid");
      });
    }
  }

  function syncLightboxState() {
    if (lightboxMode === "video" && lightboxPathValue) {
      const currentLightboxVideo = sharedVideo.getElementsByPath(
        lightboxPathValue,
      ).find((element) => sharedVideo.getElementSurface(element) === "lightbox");

      sharedVideo.storePlayback(
        lightboxPathValue,
        currentLightboxVideo ?? null,
        {
          preferredSurface: "grid",
          shouldResume: false,
        },
      );
      sharedVideo.pauseElement(currentLightboxVideo ?? null);
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
    lightboxImageUrl = "";
    lightboxImageError = false;
    lightboxVideoUrl = "";
    lightboxVideoReady = false;
    lightboxVideoProgressLabel = "Preparing video for browser playback...";
    lightboxVideoProgressValue = "0%";
    lightboxVideoProgressWidth = "0%";
    lightboxVideoErrorText = "";
    lightboxImageAlt = isImage ? currentFile.name : "";
    lightboxTitleValue = currentFile.name;
    lightboxMetaItems = buildMediaLightboxMetaItems({
      file: currentFile,
      mediaOffset: ui.mediaOffset,
      lightboxIndex: ui.lightboxIndex,
      totalMedia: ui.totalMedia,
      formatBytes,
      formatDateTime,
      formatImageDimensions,
      tagIndexMap: ui.tagIndexMap,
    });
    lightboxPrevDisabled = ui.page <= 1 && ui.lightboxIndex <= 0;
    lightboxNextDisabled =
      ui.page >= ui.totalPages &&
      ui.lightboxIndex >= ui.visibleMediaFiles.length - 1;
    ui.lightboxImageNaturalWidth = 0;
    ui.lightboxImageNaturalHeight = 0;
    resetLightboxZoom();
    scheduleLightboxMediaLoad();
  }

  function scheduleLightboxMediaLoad() {
    if (lightboxDebounceTimer) {
      clearTimeout(lightboxDebounceTimer);
    }
    lightboxDebounceTimer = setTimeout(() => {
      lightboxDebounceTimer = undefined;
      commitLightboxMediaLoad();
    }, lightboxLoadDebounceMs);
  }

  function schedulePageLoad() {
    if (pageLoadDebounceTimer) {
      clearTimeout(pageLoadDebounceTimer);
    }
    pageLoadDebounceTimer = setTimeout(() => {
      pageLoadDebounceTimer = undefined;
      loadFiles();
    }, pageLoadDebounceMs);
  }

  function commitLightboxMediaLoad() {
    if (!lightboxOpen) return;
    const currentFile = ui.visibleMediaFiles[ui.lightboxIndex];
    if (!currentFile) return;
    if (lightboxPathValue !== currentFile.path) return;

    const isImage = isImageFile(currentFile.extension);
    const isVideo = isVideoFile(currentFile.extension);

    lightboxImageUrl = isImage ? getMediaUrl(currentFile.path) : "";
    lightboxImageError = false;
    lightboxVideoUrl = "";
    lightboxVideoReady = false;
    lightboxVideoProgressLabel = "Preparing video for browser playback...";
    lightboxVideoProgressValue = "0%";
    lightboxVideoProgressWidth = "0%";
    lightboxVideoErrorText = "";
    ui.lightboxImageNaturalWidth = 0;
    ui.lightboxImageNaturalHeight = 0;

    if (isVideo) {
      sharedVideo.handoffToSurface(currentFile.path, "lightbox", true);
      syncLightboxVideoPreparation(
        currentFile.path,
        getVideoPreparationEntry(currentFile.path, currentFile.extension),
      );
      ensureVideoPreparation(currentFile);
    }
  }

  function handleSharedVideoPlay(
    filePath: string,
    surface: "grid" | "lightbox",
    element: EventTarget | null,
  ) {
    if (sharedVideo.shouldIgnoreEvent(filePath, element)) {
      return;
    }

    const videoEl = element as HTMLVideoElement | null;
    sharedVideo.storePlayback(filePath, videoEl, {
      shouldResume: true,
      preferredSurface: surface,
    });
    sharedVideo.pauseOthers(filePath, videoEl);
  }

  function handleSharedVideoPause(
    filePath: string,
    surface: "grid" | "lightbox",
    element: EventTarget | null,
  ) {
    if (sharedVideo.shouldIgnoreEvent(filePath, element)) {
      return;
    }

    const videoEl = element as HTMLVideoElement | null;
    sharedVideo.storePlayback(filePath, videoEl, {
      shouldResume: false,
      preferredSurface: surface,
    });
  }

  function handleSharedVideoTimeUpdate(
    filePath: string,
    element: EventTarget | null,
  ) {
    if (sharedVideo.shouldIgnoreEvent(filePath, element)) {
      return;
    }

    const videoEl = element as HTMLVideoElement | null;
    sharedVideo.storePlayback(filePath, videoEl, {
      shouldResume: sharedVideo.isPlaybackActive(videoEl),
    });
  }

  function handleSharedVideoSeeked(
    filePath: string,
    element: EventTarget | null,
  ) {
    if (sharedVideo.shouldIgnoreEvent(filePath, element)) {
      return;
    }

    sharedVideo.storePlayback(filePath, element as HTMLVideoElement | null);
  }

  function handleSharedVideoLoadedMetadata(
    filePath: string,
    surface: "grid" | "lightbox",
    element: EventTarget | null,
  ) {
    if (!filePath || !(element instanceof HTMLVideoElement)) {
      return;
    }

    sharedVideo.syncSurface(filePath, surface);
  }

  function handleSharedVideoEnded(
    filePath: string,
    surface: "grid" | "lightbox",
    element: EventTarget | null,
  ) {
    if (sharedVideo.shouldIgnoreEvent(filePath, element)) {
      return;
    }

    sharedVideo.storePlayback(filePath, element as HTMLVideoElement | null, {
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
    lightboxMetaItems = buildArchiveLightboxMetaItems(file, formatBytes);
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
        { headers: getAuthHeaders(getCurrentSession()) },
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
    const nextState = buildArchivePreviewState(
      relativePath,
      archivePreviewDirectories,
      archivePreviewFiles,
    );
    archivePreviewCurrentDirectory = nextState.currentDirectory;
    lightboxZipCurrentDirectory = nextState.currentDirectory;
    lightboxZipRootDirectories = nextState.rootDirectories;
    lightboxZipFiles = nextState.files;
    lightboxZipBreadcrumbs = nextState.breadcrumbs;
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
    const session = getCurrentSession();
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

  function getLightboxZoomPercent(): number {
    return getCurrentLightboxZoomPercent(
      lightboxZoomValue,
      LIGHTBOX_FIT_ZOOM_VALUE,
      getFitZoomPercent(),
    );
  }

  function updateLightboxZoomOptionLabels() {
    const fitPercent = getFitZoomPercent();
    lightboxZoomOptions = buildLightboxZoomOptions(
      LIGHTBOX_FIT_ZOOM_VALUE,
      LIGHTBOX_ZOOM_LEVELS,
      fitPercent,
    );
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
    const currentZoomPercent = getLightboxZoomPercent();
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
    const wasFit = lightboxZoomValue === LIGHTBOX_FIT_ZOOM_VALUE;
    const anchor = wasFit ? null : captureLightboxCenterAnchor();
    const nextValue = value || LIGHTBOX_FIT_ZOOM_VALUE;
    lightboxZoomValue = nextValue;
    lightboxZoomMenuOpen = false;
    updateLightboxZoomOptionLabels();
    updateLightboxZoomControls();
    updateLightboxImageStyle();
    if (wasFit) {
      centerLightboxImageInViewport();
    } else {
      restoreLightboxCenterAnchor(anchor);
    }
    syncLocationState();
  }

  function centerLightboxImageInViewport() {
    window.requestAnimationFrame(() => {
      const backdrop = document.getElementById("lightboxBackdrop");
      if (!backdrop) return;
      backdrop.scrollLeft = Math.max(0, (backdrop.scrollWidth - backdrop.clientWidth) / 2);
      backdrop.scrollTop = Math.max(0, (backdrop.scrollHeight - backdrop.clientHeight) / 2);
    });
  }

  function nudgeLightboxZoom(direction: number) {
    if (lightboxMode !== "image") return;
    const currentZoomPercent = getLightboxZoomPercent();
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
    lightboxImageError = false;
    updateLightboxZoomOptionLabels();
    updateLightboxZoomControls();
    updateLightboxImageStyle();
  }

  function handleLightboxImageError() {
    lightboxImageError = true;
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
    ui.lightboxPinchStartZoomPercent = getLightboxZoomPercent();
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
    const existingSession = getCurrentSession();
    if (!authEnabled || existingSession) {
      const initialLocation = readInitialLocationState();
      ui.currentDir = initialLocation.directory;
      ui.page = initialLocation.page;
      ui.pageSize = initialLocation.pageSize;
      nameFilter = initialLocation.filename;
      pageSizeDisplay = String(initialLocation.pageSize);
      ui.requestedExtensions = new Set(initialLocation.selectedExtensions);
      ui.selectedExtensions = new Set(initialLocation.selectedExtensions);
      ui.requestedTags = new Set(initialLocation.requestedTags);
      selectedTagsList = [...ui.requestedTags].sort();
      ui.untagged = initialLocation.untagged;
      ui.tagged = initialLocation.tagged;
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
    const openPath = kebabMenuOpenPath;
    if (!openPath) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const container = document.querySelector(
        `[data-kebab-path="${CSS.escape(openPath!)}"]`,
      );
      if (container && !container.contains(target)) {
        kebabMenuOpenPath = null;
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

{#snippet kebabMenu(path: string)}
  <div class="relative" data-kebab-path={path}>
    <button
      type="button"
      aria-label="Item actions"
      onclick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        kebabMenuOpenPath = kebabMenuOpenPath === path ? null : path;
      }}
      class="inline-flex items-center justify-center rounded-md p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
    >
      <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
        ><path
          d="M10 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"
        /></svg
      >
    </button>
    {#if kebabMenuOpenPath === path}
      <div
        role="presentation"
        class="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur"
        onclick={(e) => e.stopPropagation()}
        onkeydown={() => {}}
      >
        {#if isProcessableImagePath(path)}
          <button
            type="button"
            onclick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              kebabMenuOpenPath = null;
              handleKebabProcess(path);
            }}
            class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-800 hover:text-cyan-200"
          >
            <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor"
              ><path
                fill-rule="evenodd"
                d="M12.493 2.75a.75.75 0 0 1 .53 1.28L11.06 6h2.19A3.75 3.75 0 1 1 9.5 9.75a.75.75 0 0 1 1.5 0 2.25 2.25 0 1 0 2.25-2.25h-2.19l1.963 1.97a.75.75 0 0 1-1.06 1.06l-3.243-3.25a.75.75 0 0 1 0-1.06l3.243-3.25a.748.748 0 0 1 .53-.22Z"
                clip-rule="evenodd"
              /></svg
            >
            Process
          </button>
        {/if}
        <button
          type="button"
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            kebabMenuOpenPath = null;
            handleKebabZip(path);
          }}
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-800 hover:text-cyan-200"
        >
          <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor"
            ><path
              d="M7 2.75A1.75 1.75 0 0 0 5.25 4.5v11A1.75 1.75 0 0 0 7 17.25h6A1.75 1.75 0 0 0 14.75 15.5v-7a.75.75 0 0 0-.22-.53l-3-3A.75.75 0 0 0 11 4.75H7Z"
            /></svg
          >
          Zip
        </button>
        <button
          type="button"
          onclick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            kebabMenuOpenPath = null;
            handleKebabTags(path);
          }}
          class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-800 hover:text-cyan-200"
        >
          <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor"
            ><path
              fill-rule="evenodd"
              d="M5.5 2.75A1.75 1.75 0 0 0 3.75 4.5v4.69c0 .464.184.909.513 1.237l6.75 6.75a1.75 1.75 0 0 0 2.474 0l4.69-4.69a1.75 1.75 0 0 0 0-2.474l-6.75-6.75A1.75 1.75 0 0 0 9.19 2.75H5.5ZM6 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clip-rule="evenodd"
            /></svg
          >
          Tags
        </button>
      </div>
    {/if}
  </div>
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
        {#if availableTags.length || ui.untagged || ui.tagged}
          <div
            class="flex flex-wrap gap-2 basis-full grow-0 shrink-0 order-2 sm:order-none mt-1"
          >
            <button
              type="button"
              class="rounded-full border px-2.5 py-0.5 text-xs transition {ui.tagged
                ? 'border-2 border-teal-400/40 bg-teal-950/40 font-semibold text-teal-400'
                : 'border border-teal-400/30 bg-slate-950 text-teal-400 hover:border-teal-400/40 hover:bg-teal-950/40'}"
              onclick={() => {
                ui.tagged = !ui.tagged;
                if (ui.tagged) { ui.untagged = false; ui.requestedTags = new Set(); }
                selectedTagsList = [...ui.requestedTags].sort();
                ui.page = 1;
                loadFiles();
              }}
            >tagged</button
            >
            <button
              type="button"
              class="rounded-full border px-2.5 py-0.5 text-xs transition {ui.untagged
                ? 'border-2 border-slate-400/40 bg-slate-800/40 font-semibold text-slate-400'
                : 'border border-slate-400/30 bg-slate-950 text-slate-400 hover:border-slate-400/40 hover:bg-slate-800/40'}"
              onclick={() => {
                ui.untagged = !ui.untagged;
                if (ui.untagged) { ui.tagged = false; ui.requestedTags = new Set(); }
                selectedTagsList = [...ui.requestedTags].sort();
                ui.page = 1;
                loadFiles();
              }}
            >untagged</button
            >
            {#each availableTags as tag}
              <button
                type="button"
                class={tagFilterButtonClass(tag, selectedTagsList.includes(tag), ui.tagIndexMap)}
                onclick={() => toggleTag(tag)}
              >{tag}</button
              >
            {/each}
          </div>
        {/if}
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
            aria-label="Tag selected items"
            onclick={openTagsDialog}
            disabled={!hasSelection}
            type="button"
            class="group relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-violet-700 bg-violet-950/30 px-3 text-xs font-medium text-violet-200 transition hover:border-violet-500 hover:text-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
              ><path
                fill-rule="evenodd"
                d="M5.5 2.75A1.75 1.75 0 0 0 3.75 4.5v4.69c0 .464.184.909.513 1.237l6.75 6.75a1.75 1.75 0 0 0 2.474 0l4.69-4.69a1.75 1.75 0 0 0 0-2.474l-6.75-6.75A1.75 1.75 0 0 0 9.19 2.75H5.5ZM6 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                clip-rule="evenodd"
              /></svg
            >
            Tags
          </button>
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
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="min-w-0 truncate font-semibold text-cyan-300"
                          >{directory.name}/</span
                        >
                        {#if directory.tags?.length}
                          <div class="flex shrink-0 flex-wrap items-center gap-1 text-xs">
                            {#each directory.tags as tag}
                              <span class={tagChipClass(tag, ui.tagIndexMap)}>{tag}</span>
                            {/each}
                          </div>
                        {/if}
                      </div>
                      <span class="text-xs text-slate-500">Folder</span>
                    </button>
                    <div class="ml-auto">
                      {@render kebabMenu(directory.path)}
                    </div>
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
                      class="min-w-0 truncate text-slate-100 underline-offset-4 hover:text-cyan-300 hover:underline"
                      href={getDownloadUrl(file.path)}>{file.name}</a
                    >
                    <span
                      class="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400"
                      >.{file.extension || "none"}</span
                    >
                    {#if file.tags?.length}
                      <div class="flex shrink-0 flex-wrap items-center gap-1 text-xs">
                        {#each file.tags as tag}
                          <span class={tagChipClass(tag, ui.tagIndexMap)}>{tag}</span>
                        {/each}
                      </div>
                    {/if}
                    <span class="ml-auto text-xs text-slate-400"
                      >{formatBytes(file.size)}</span
                    >
                    <span class="text-xs text-slate-500"
                      >{formatDateTime(file.modifiedAt)}</span
                    >
                    <span class="ml-auto shrink-0">
                      {@render kebabMenu(file.path)}
                    </span>
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
                        {#if directory.tags?.length}
                          <div class="mt-1 flex flex-wrap items-center gap-1 text-xs">
                            {#each directory.tags as tag}
                              <span class={tagChipClass(tag, ui.tagIndexMap)}>{tag}</span>
                            {/each}
                          </div>
                        {/if}
                      </div>
                    </button>
                    <div class="absolute right-2 top-2 z-20">
                      {@render kebabMenu(directory.path)}
                    </div>
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
                    class="rounded-lg border border-slate-800 bg-slate-900/40 transition hover:border-cyan-500 hover:bg-slate-900/70"
                  >
                    <div class="group relative">
                      <div class="aspect-[4/3] overflow-hidden rounded-t-lg bg-slate-950">
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
                      {#if isImageFile(file.extension) || isVideoFile(file.extension)}
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
                        <span class="ml-auto shrink-0">
                          {@render kebabMenu(file.path)}
                        </span>
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
                      {#if file.tags?.length}
                        <div class="flex flex-wrap items-center gap-1 text-xs">
                          {#each file.tags as tag}
                            <span class={tagChipClass(tag, ui.tagIndexMap)}>{tag}</span>
                          {/each}
                        </div>
                      {/if}
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
            schedulePageLoad();
          }}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              ui.page = Math.min(
                ui.totalPages,
                Math.max(1, Number(pageInputValue || "1")),
              );
              schedulePageLoad();
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
    imageError={lightboxImageError}
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
    onImageError={handleLightboxImageError}
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
    badgeLabel="Zip"
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
    bind:rotation={compressDialogRotation}
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

{#if processDialogOpen}
  <CompressDialog
    badgeLabel="Process"
    title="Process image"
    message="Apply image options and download the processed file."
    bind:fileName={processDialogFileName}
    errorText={processDialogErrorText}
    pending={processPending}
    progress={null}
    imageInfo={processImageInfo}
    imageExtension={processImageExtension}
    showFileName={true}
    fileNameLabel="Output filename"
    imageOptionsTitle="Image options"
    actionLabel="Process"
    bind:resizeWidth={processDialogResizeWidth}
    bind:resizeHeight={processDialogResizeHeight}
    bind:rotation={processDialogRotation}
    bind:resizeQuality={processDialogResizeQuality}
    bind:imageFormat={processDialogImageFormat}
    fileCount={1}
    dirCount={0}
    totalSize={processDialogTotalSize}
    formatBytes={formatBytes}
    onCompress={handleProcessImage}
    onCancel={closeProcessDialog}
  />
{/if}

<TagsDialog
  show={tagsDialogOpen}
  currentDir={ui.currentDir}
  selectedItems={tagsDialogSelectedItems}
  selectedItemNames={tagsDialogSelectedItemNames}
  tagIndexMap={ui.tagIndexMap}
  getAuthHeaders={() => getAuthHeaders(getCurrentSession())}
  onClose={closeTagsDialog}
/>

<Toaster position="top-right" richColors closeButton />
