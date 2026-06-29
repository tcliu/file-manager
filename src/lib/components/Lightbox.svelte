<script lang="ts">
  interface Props {
    open: boolean;
    mode: string;
    pathValue: string;
    imageUrl: string;
    videoUrl: string;
    videoReady: boolean;
    videoProgressLabel: string;
    videoProgressValue: string;
    videoProgressWidth: string;
    videoErrorText: string;
    zipRootDirectories: { name: string; path: string; parentPath: string }[];
    zipFiles: any[];
    zipCurrentDirectory: string;
    zipBreadcrumbs: { label: string; path: string }[];
    zipLoading: boolean;
    zipErrorText: string;
    imageAlt: string;
    titleValue: string;
    metaItems: { key: string; text: string; badge: boolean }[];
    prevDisabled: boolean;
    nextDisabled: boolean;
    zoomValue: string;
    zoomMenuOpen: boolean;
    zoomInDisabled: boolean;
    zoomOutDisabled: boolean;
    canPan: boolean;
    dragging: boolean;
    imageStyle: Record<string, string>;
    zoomOptions: { value: string; label: string; sortValue: number }[];
    zoomLabel: string;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
    onNavigateArchiveDirectory: (path: string) => void;
    getArchiveEntryDownloadUrl: (file: any) => string;
    onImageLoad: (e: Event) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomChange: (value: string) => void;
    onToggleZoomMenu: () => void;
    onPointerDown: (e: PointerEvent) => void;
    onPointerMove: (e: PointerEvent) => void;
    onPointerUp: (e: PointerEvent) => void;
    onBackdropClick: (e: MouseEvent) => void;
  }

  let {
    open = $bindable(),
    mode,
    pathValue,
    imageUrl,
    videoUrl,
    videoReady,
    videoProgressLabel,
    videoProgressValue,
    videoProgressWidth,
    videoErrorText,
    zipRootDirectories,
    zipFiles,
    zipCurrentDirectory,
    zipBreadcrumbs,
    zipLoading,
    zipErrorText,
    imageAlt,
    titleValue,
    metaItems,
    prevDisabled,
    nextDisabled,
    zoomValue,
    zoomMenuOpen,
    zoomInDisabled,
    zoomOutDisabled,
    canPan,
    dragging,
    imageStyle,
    zoomOptions,
    zoomLabel,
    onClose,
    onPrev,
    onNext,
    onNavigateArchiveDirectory,
    getArchiveEntryDownloadUrl,
    onImageLoad,
    onZoomIn,
    onZoomOut,
    onZoomChange,
    onToggleZoomMenu,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onBackdropClick,
  }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowLeft") onPrev();
    if (e.key === "ArrowRight") onNext();
  }

  let backdropClass = $derived(
    mode === "image"
      ? canPan
        ? "overflow-auto cursor-grab"
        : "overflow-auto"
      : mode === "video"
        ? "overflow-hidden"
        : "overflow-auto",
  );
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="fixed inset-0 z-50 bg-slate-950/95 px-2 py-3 sm:px-3 sm:py-4 lg:px-6"
>
  <button
    onclick={onClose}
    type="button"
    aria-label="Close media viewer"
    class="absolute right-4 top-4 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 sm:right-6 sm:top-6"
  >
    <svg class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"
      ><path
        fill-rule="evenodd"
        d="M4.22 4.22a.75.75 0 0 1 1.06 0L10 8.94l4.72-4.72a.75.75 0 1 1 1.06 1.06L11.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 0 1-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 0 1 0-1.06Z"
        clip-rule="evenodd"
      /></svg
    >
  </button>

  <div
    class="mx-auto flex h-full w-full max-w-[min(88vw,1680px)] flex-col gap-2 xl:max-w-[min(calc(100vw-12rem),1680px)]"
  >
    <div
      class="shrink-0 rounded-2xl border border-slate-800 bg-slate-900/85 px-4 py-2.5 backdrop-blur"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p class="min-w-0 truncate font-semibold text-slate-100">
              {titleValue}
            </p>
            <div
              class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400"
            >
              {#each metaItems as item (item.key)}
                <span
                  class={item.badge
                    ? "rounded-full border border-slate-700 px-2 py-1"
                    : ""}>{item.text}</span
                >
              {/each}
            </div>
          </div>
        </div>
        {#if mode === "image"}
          <div class="flex items-center gap-2">
            <div class="relative">
              <button
                onclick={onToggleZoomMenu}
                type="button"
                class="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-500 hover:text-cyan-300"
              >
                {zoomLabel}
              </button>
              {#if zoomMenuOpen}
                <div
                  class="absolute right-0 top-full z-30 mt-1 min-w-[120px] rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-2xl shadow-slate-950/60"
                >
                  {#each zoomOptions as option (option.value)}
                    <button
                      type="button"
                      onclick={() => onZoomChange(option.value)}
                      class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition {option.value ===
                      zoomValue
                        ? 'bg-cyan-500/15 text-cyan-200'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200'}"
                    >
                      <span>{option.label}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
            <button
              onclick={onZoomOut}
              disabled={zoomOutDisabled}
              type="button"
              aria-label="Zoom out"
              class="group relative inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-200 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
                ><path
                  fill-rule="evenodd"
                  d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm7-1.25a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0V6.31l-2.22 2.22a.75.75 0 1 1-1.06-1.06l2.22-2.22H12a.75.75 0 0 1-.75-.75Z"
                  clip-rule="evenodd"
                /></svg
              >
              <span
                class="pointer-events-none absolute -bottom-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition group-hover:opacity-100"
                >Zoom out</span
              >
            </button>
            <button
              onclick={onZoomIn}
              disabled={zoomInDisabled}
              type="button"
              aria-label="Zoom in"
              class="group relative inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-200 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
                ><path
                  fill-rule="evenodd"
                  d="M9.25 3.25a.75.75 0 0 0-1.5 0v4.25H3.5a.75.75 0 0 0 0 1.5h4.25v4.25a.75.75 0 0 0 1.5 0v-4.25H13a.75.75 0 0 0 0-1.5H9.25V3.25Z"
                  clip-rule="evenodd"
                /></svg
              >
              <span
                class="pointer-events-none absolute -bottom-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 opacity-0 shadow-lg transition group-hover:opacity-100"
                >Zoom in</span
              >
            </button>
          </div>
        {/if}
      </div>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      id="lightboxBackdrop"
      class="min-h-0 flex-1 flex items-center justify-center {backdropClass}"
      style={dragging ? "cursor: grabbing;" : ""}
      onclick={onBackdropClick}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
    >
      {#if mode === "image"}
        <img
          src={imageUrl}
          alt={imageAlt}
          style={Object.keys(imageStyle).length > 0
            ? Object.entries(imageStyle)
                .map(([k, v]) => `${k}: ${v}`)
                .join("; ")
            : "max-width: 100%; max-height: 100%; object-fit: contain;"}
          class="block max-w-none shrink-0"
          onload={onImageLoad}
        />
      {/if}

      {#if mode !== "image"}
        <div class="flex items-center justify-center p-4">
          {#if mode === "video" && !videoReady}
            <div
              class="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl shadow-slate-950/50"
            >
              <p class="text-lg font-semibold text-slate-100">
                {videoProgressLabel}
              </p>
              <p class="mt-2 text-sm text-slate-400">{videoProgressValue}</p>
              <div class="mt-4 h-3 overflow-hidden rounded-full bg-slate-800">
                <div
                  style="width: {videoProgressWidth}"
                  class="h-full w-0 rounded-full bg-cyan-500 transition-[width] duration-300"
                ></div>
              </div>
              <p class="mt-4 min-h-5 text-sm text-rose-300">{videoErrorText}</p>
            </div>
          {/if}

          {#if mode === "video" && videoReady}
            <video
              src={videoUrl}
              class="max-h-full max-w-full"
              controls
              playsinline
              preload="none"
            >
              <track kind="captions" label="No captions available" default />
            </video>
          {/if}

          {#if mode === "zip"}
            <div
              class="w-full max-w-5xl rounded-3xl border border-slate-800 bg-slate-900/90 p-4 shadow-2xl shadow-slate-950/50 sm:p-5"
            >
              <div
                class="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3"
              >
                {#each zipBreadcrumbs as item, index (item.path)}
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-200 transition hover:border-cyan-500 hover:text-cyan-300"
                      onclick={() => onNavigateArchiveDirectory(item.path)}
                      >{item.label}</button
                    >
                    {#if index < zipBreadcrumbs.length - 1 && item.label !== "/"}<span
                        class="text-slate-600">/</span
                      >{/if}
                  </div>
                {/each}
              </div>
              {#if zipLoading}
                <p class="py-8 text-sm text-slate-400">
                  Reading archive contents...
                </p>
              {:else if zipErrorText}
                <p class="py-8 text-sm text-rose-300">{zipErrorText}</p>
              {:else}
                <div class="pt-4">
                  {#if !zipRootDirectories.length && !zipFiles.length}
                    <p class="py-8 text-sm text-slate-400">
                      This archive is empty.
                    </p>
                  {:else}
                    <div class="space-y-3">
                      {#each zipRootDirectories as directory (directory.path)}
                        <button
                          type="button"
                          class="flex w-full items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-left transition hover:border-cyan-500 hover:bg-slate-950"
                          onclick={() =>
                            onNavigateArchiveDirectory(directory.path)}
                        >
                          <span
                            class="min-w-0 truncate font-semibold text-cyan-300"
                            >{directory.name}/</span
                          >
                          <span class="text-xs text-slate-500">Folder</span>
                        </button>
                      {/each}
                      {#each zipFiles as file (file.path)}
                        <a
                          href={getArchiveEntryDownloadUrl(file)}
                          download={file.name}
                          class="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 transition hover:border-cyan-500 hover:bg-slate-950"
                        >
                          <span class="min-w-0 flex-1 truncate text-slate-100"
                            >{file.name}</span
                          >
                          <span
                            class="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400"
                            >.{file.extension || "none"}</span
                          >
                        </a>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  {#if mode !== "zip"}
    <button
      onclick={onPrev}
      disabled={prevDisabled}
      type="button"
      aria-label="Previous media"
      class="absolute left-3 top-1/2 z-20 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 sm:flex sm:left-6 disabled:opacity-40"
    >
      <svg class="h-7 w-7" viewBox="0 0 20 20" fill="currentColor"
        ><path
          fill-rule="evenodd"
          d="M11.78 4.22a.75.75 0 0 1 0 1.06L7.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06l-5.25-5.25a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z"
          clip-rule="evenodd"
        /></svg
      >
    </button>
    <button
      onclick={onNext}
      disabled={nextDisabled}
      type="button"
      aria-label="Next media"
      class="absolute right-3 top-1/2 z-20 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-slate-700 bg-slate-900/90 text-slate-100 transition hover:border-cyan-500 hover:text-cyan-300 sm:flex sm:right-6 disabled:opacity-40"
    >
      <svg class="h-7 w-7" viewBox="0 0 20 20" fill="currentColor"
        ><path
          fill-rule="evenodd"
          d="M8.22 15.78a.75.75 0 0 1 0-1.06L12.94 10 8.22 5.28a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 0 1-1.06 0Z"
          clip-rule="evenodd"
        /></svg
      >
    </button>
  {/if}
</div>
