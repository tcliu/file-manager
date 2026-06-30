export interface SharedVideoPlaybackEntry {
  currentTime: number;
  shouldResume: boolean;
  preferredSurface: 'grid' | 'lightbox';
}

export interface SharedVideoController {
  getPlaybackEntry: (filePath: string) => SharedVideoPlaybackEntry;
  storePlayback: (
    filePath: string,
    element: HTMLVideoElement | null,
    nextValues?: Partial<SharedVideoPlaybackEntry>,
  ) => SharedVideoPlaybackEntry;
  pauseElement: (element: HTMLVideoElement | null) => void;
  isPlaybackActive: (element: HTMLVideoElement | null) => boolean;
  getElementsByPath: (filePath: string) => HTMLVideoElement[];
  getElementSurface: (element: HTMLVideoElement) => 'grid' | 'lightbox' | '';
  handoffToSurface: (
    filePath: string,
    surface: 'grid' | 'lightbox',
    defaultShouldResume?: boolean,
  ) => void;
  syncSurface: (filePath: string, surface: 'grid' | 'lightbox') => void;
  shouldIgnoreEvent: (filePath: string, element: EventTarget | null) => boolean;
}

export function createSharedVideoController(): SharedVideoController {
  const playbackByPath = new Map<string, SharedVideoPlaybackEntry>();
  let syncDepth = 0;

  function getPlaybackEntry(filePath: string): SharedVideoPlaybackEntry {
    const normalizedPath = String(filePath || '');
    if (!normalizedPath) {
      return {
        currentTime: 0,
        shouldResume: false,
        preferredSurface: 'grid',
      };
    }

    const existing = playbackByPath.get(normalizedPath);
    if (existing) {
      return existing;
    }

    const entry: SharedVideoPlaybackEntry = {
      currentTime: 0,
      shouldResume: false,
      preferredSurface: 'grid',
    };
    playbackByPath.set(normalizedPath, entry);
    return entry;
  }

  function updatePlaybackEntry(
    filePath: string,
    nextValues: Partial<SharedVideoPlaybackEntry>,
  ): SharedVideoPlaybackEntry {
    if (!filePath) {
      return getPlaybackEntry(filePath);
    }

    const entry = getPlaybackEntry(filePath);
    Object.assign(entry, nextValues);
    return entry;
  }

  function storePlayback(
    filePath: string,
    element: HTMLVideoElement | null,
    nextValues: Partial<SharedVideoPlaybackEntry> = {},
  ): SharedVideoPlaybackEntry {
    if (!filePath) {
      return getPlaybackEntry(filePath);
    }

    const currentTime =
      element instanceof HTMLVideoElement && Number.isFinite(element.currentTime)
        ? Math.max(0, element.currentTime)
        : undefined;

    return updatePlaybackEntry(filePath, {
      ...(currentTime === undefined ? {} : { currentTime }),
      ...nextValues,
    });
  }

  function runWithSyncSuppressed<T>(callback: () => T): T {
    syncDepth += 1;
    try {
      return callback();
    } finally {
      syncDepth = Math.max(0, syncDepth - 1);
    }
  }

  function shouldIgnoreEvent(filePath: string, element: EventTarget | null): boolean {
    return syncDepth > 0 || !filePath || !(element instanceof HTMLVideoElement);
  }

  function getElements(): HTMLVideoElement[] {
    if (typeof document === 'undefined') {
      return [];
    }

    return [...document.querySelectorAll('video[data-shared-video]')].filter(
      (element): element is HTMLVideoElement => element instanceof HTMLVideoElement && element.isConnected,
    );
  }

  function getElementPath(element: HTMLVideoElement): string {
    return String(element.dataset.videoPath || '');
  }

  function getElementSurface(element: HTMLVideoElement): 'grid' | 'lightbox' | '' {
    const surface = String(element.dataset.sharedVideo || '');
    return surface === 'grid' || surface === 'lightbox' ? surface : '';
  }

  function isPlaybackActive(element: HTMLVideoElement | null): boolean {
    return !!element && !element.paused && !element.ended;
  }

  function getElementsByPath(filePath: string): HTMLVideoElement[] {
    return getElements().filter((element) => getElementPath(element) === filePath);
  }

  function getPreferredElement(filePath: string): HTMLVideoElement | null {
    const matchingElements = getElementsByPath(filePath);
    const activeElement = matchingElements.find((element) => isPlaybackActive(element));
    if (activeElement) {
      return activeElement;
    }

    return (
      matchingElements.find((element) => getElementSurface(element) === 'lightbox') ??
      matchingElements[0] ??
      null
    );
  }

  function clampPlaybackTime(element: HTMLVideoElement, currentTime: number): number {
    if (!Number.isFinite(currentTime)) {
      return 0;
    }
    if (!Number.isFinite(element.duration)) {
      return Math.max(0, currentTime);
    }

    return Math.min(Math.max(0, currentTime), Math.max(0, element.duration - 0.25));
  }

  function pauseElement(element: HTMLVideoElement | null) {
    if (!element || element.paused) {
      return;
    }

    runWithSyncSuppressed(() => {
      element.pause();
    });
  }

  function pauseOtherVideos(activeFilePath: string, activeElement: HTMLVideoElement | null = null) {
    for (const element of getElements()) {
      if (element === activeElement) {
        continue;
      }

      const filePath = getElementPath(element);
      if (!filePath) {
        continue;
      }

      storePlayback(filePath, element, filePath === activeFilePath ? {} : { shouldResume: false });
      pauseElement(element);
    }
  }

  function applyPlaybackToElement(
    filePath: string,
    surface: 'grid' | 'lightbox',
    element: HTMLVideoElement,
  ) {
    if (!filePath) {
      return;
    }

    const entry = getPlaybackEntry(filePath);

    runWithSyncSuppressed(() => {
      if (element.readyState >= 1 && Number.isFinite(entry.currentTime)) {
        const targetTime = clampPlaybackTime(element, entry.currentTime);
        if (Math.abs(element.currentTime - targetTime) > 0.2) {
          element.currentTime = targetTime;
        }
      }

      if (entry.shouldResume && entry.preferredSurface === surface) {
        pauseOtherVideos(filePath, element);
        const playResult = element.play();
        if (playResult && typeof playResult.catch === 'function') {
          playResult.catch(() => {});
        }
        return;
      }

      if (!element.paused) {
        element.pause();
      }
    });
  }

  function handoffToSurface(
    filePath: string,
    surface: 'grid' | 'lightbox',
    defaultShouldResume = false,
  ) {
    if (!filePath) {
      return;
    }

    const entry = getPlaybackEntry(filePath);
    const sourceElement = getPreferredElement(filePath);
    const shouldResume = sourceElement
      ? isPlaybackActive(sourceElement) || defaultShouldResume
      : entry.shouldResume || defaultShouldResume;

    storePlayback(filePath, sourceElement, {
      preferredSurface: surface,
      shouldResume,
    });
    pauseOtherVideos(filePath, null);
  }

  function syncSurface(filePath: string, surface: 'grid' | 'lightbox') {
    if (!filePath) {
      return;
    }

    const targetElement = getElementsByPath(filePath).find(
      (element) => getElementSurface(element) === surface,
    );
    if (!targetElement) {
      return;
    }

    applyPlaybackToElement(filePath, surface, targetElement);
  }

  return {
    getPlaybackEntry,
    storePlayback,
    pauseElement,
    isPlaybackActive,
    getElementsByPath,
    getElementSurface,
    handoffToSurface,
    syncSurface,
    shouldIgnoreEvent,
  };
}
