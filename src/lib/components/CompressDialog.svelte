<script lang="ts">
  import { tick } from "svelte";

  interface ImageInfo {
    width: number;
    height: number;
  }

  interface Props {
    title: string;
    message: string;
    fileName: string;
    errorText: string;
    pending: boolean;
    progress: number | null;
    imageInfo: ImageInfo | null;
    imageExtension: string | null;
    resizeWidth: number;
    resizeHeight: number;
    rotation: number;
    resizeQuality: number;
    imageFormat: string;
    fileCount: number;
    dirCount: number;
    totalSize: number;
    formatBytes: (bytes: number) => string;
    onCompress: () => void;
    onCancel: () => void;
  }

  let {
    title,
    message,
    fileName = $bindable(),
    errorText,
    pending,
    progress = $bindable(),
    imageInfo,
    imageExtension,
    resizeWidth = $bindable(),
    resizeHeight = $bindable(),
    rotation = $bindable(),
    resizeQuality = $bindable(),
    imageFormat = $bindable(),
    fileCount,
    dirCount,
    totalSize,
    formatBytes,
    onCompress,
    onCancel,
  }: Props = $props();

  let inputRef = $state<HTMLInputElement | null>(null);
  let resizeRatio = $state(100);
  let prevImageInfo = $state<ImageInfo | null>(null);
  let prevRotation = $state(rotation);
  let imageFormatMenuOpen = $state(false);
  let imageFormatContainerRef = $state<HTMLDivElement | null>(null);

  function isQuarterTurn(value: number) {
    return value === 90 || value === 270;
  }

  const effectiveImageInfo = $derived.by(() => {
    if (!imageInfo) return null;
    return isQuarterTurn(rotation)
      ? { width: imageInfo.height, height: imageInfo.width }
      : imageInfo;
  });

  $effect(() => {
    void title;
    tick().then(() => {
      inputRef?.focus();
    });
  });

  const aspectRatio = $derived.by(() => {
    if (!effectiveImageInfo) return 1;
    const w = Number(effectiveImageInfo.width);
    const h = Number(effectiveImageInfo.height);
    return w > 0 && h > 0 ? w / h : 1;
  });

  function syncResizeRatio(width: number) {
    if (!effectiveImageInfo) return;
    resizeRatio = Math.max(
      1,
      Math.min(100, Math.round((width / effectiveImageInfo.width) * 100)),
    );
  }

  $effect(() => {
    if (
      imageInfo &&
      (!prevImageInfo ||
        prevImageInfo.width !== imageInfo.width ||
        prevImageInfo.height !== imageInfo.height)
    ) {
      prevImageInfo = imageInfo;
      resizeWidth = effectiveImageInfo?.width ?? imageInfo.width;
      resizeHeight = effectiveImageInfo?.height ?? imageInfo.height;
      resizeRatio = 100;
    }
  });

  $effect(() => {
    if (!imageInfo) {
      prevRotation = rotation;
      return;
    }
    if (isQuarterTurn(prevRotation) !== isQuarterTurn(rotation)) {
      [resizeWidth, resizeHeight] = [
        Math.max(1, resizeHeight),
        Math.max(1, resizeWidth),
      ];
      syncResizeRatio(resizeWidth);
    }
    prevRotation = rotation;
  });

  function handleRatioChange(value: number) {
    if (!effectiveImageInfo) return;
    const ratio = Math.max(1, Math.min(100, Math.round(value))) / 100;
    resizeWidth = Math.max(1, Math.round(effectiveImageInfo.width * ratio));
    resizeHeight = Math.max(1, Math.round(effectiveImageInfo.height * ratio));
  }

  function handleWidthChange(value: number) {
    if (!effectiveImageInfo) return;
    const w = Math.max(1, Math.round(value));
    const h = Math.max(1, Math.round(w / aspectRatio));
    resizeWidth = w;
    resizeHeight = h;
    syncResizeRatio(w);
  }

  function handleHeightChange(value: number) {
    if (!effectiveImageInfo) return;
    const h = Math.max(1, Math.round(value));
    const w = Math.max(1, Math.round(h * aspectRatio));
    resizeHeight = h;
    resizeWidth = w;
    syncResizeRatio(w);
  }

  function handleRotationChange(nextRotation: number) {
    rotation = nextRotation;
  }

  const formatLabel = $derived(imageFormat === "png" ? "PNG" : "JPEG");

  $effect(() => {
    if (!imageFormatMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        imageFormatContainerRef &&
        !imageFormatContainerRef.contains(e.target as Node)
      ) {
        imageFormatMenuOpen = false;
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && !pending) onCancel();
  }}
/>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 bg-slate-950/80 px-4 py-6" onclick={onCancel}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="flex min-h-full items-center justify-center"
    onclick={(e) => e.stopPropagation()}
  >
    <section
      class="relative w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onclick={onCancel}
        disabled={pending}
        class="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
          ><path
            d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
          /></svg
        >
      </button>
      <p
        class="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300"
      >
        Zip
      </p>
      <h2 class="mt-3 text-2xl font-semibold tracking-tight text-slate-100">
        {title}
      </h2>
      <p class="mt-3 text-sm leading-6 text-slate-400">{message}</p>
      <div class="mt-3 flex flex-wrap gap-2 text-xs">
        {#if dirCount}
          <span
            class="rounded-full border border-slate-700 px-2 py-1 text-slate-400"
            >{dirCount} folder{dirCount !== 1 ? "s" : ""}</span
          >
        {/if}
        {#if fileCount}
          <span
            class="rounded-full border border-slate-700 px-2 py-1 text-slate-400"
            >{fileCount} file{fileCount !== 1 ? "s" : ""}</span
          >
        {/if}
        <span
          class="rounded-full border border-slate-700 px-2 py-1 text-slate-400"
          >{formatBytes(totalSize)}</span
        >
      </div>
      <label class="mt-5 block text-sm text-slate-300">
        <span class="mb-2 block">Zip filename</span>
        <input
          bind:value={fileName}
          bind:this={inputRef}
          type="text"
          disabled={pending}
          class="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
          onkeydown={(event) => {
            if (event.key === "Enter" && !pending) {
              event.preventDefault();
              onCompress();
            }
          }}
        />
      </label>
      {#if imageInfo}
        <div class="mt-5">
          <p
            class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500"
          >
            Image options
          </p>
          <div
            class="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3 text-sm text-slate-300"
          >
            {#if imageExtension}
              <span class="shrink-0">Image Type</span>
              <div
                class="relative"
                bind:this={imageFormatContainerRef}
                onfocusout={(e) => {
                  if (
                    imageFormatContainerRef &&
                    !imageFormatContainerRef.contains(e.relatedTarget as Node)
                  ) {
                    imageFormatMenuOpen = false;
                  }
                }}
              >
                <button
                  type="button"
                  onclick={() => {
                    imageFormatMenuOpen = !imageFormatMenuOpen;
                  }}
                  disabled={pending}
                  class="inline-flex min-w-20 items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none transition hover:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span>{formatLabel}</span>
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
                {#if imageFormatMenuOpen}
                  <div
                    class="absolute left-0 z-20 mt-2 w-28 overflow-hidden rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur"
                  >
                    <button
                      type="button"
                      onclick={() => {
                        imageFormat = "jpeg";
                        imageFormatMenuOpen = false;
                      }}
                      class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition {imageFormat ===
                      'jpeg'
                        ? 'bg-cyan-500/15 text-cyan-200'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200'}"
                    >
                      <span>JPEG</span>
                    </button>
                    <button
                      type="button"
                      onclick={() => {
                        imageFormat = "png";
                        imageFormatMenuOpen = false;
                      }}
                      class="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition {imageFormat ===
                      'png'
                        ? 'bg-cyan-500/15 text-cyan-200'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-cyan-200'}"
                    >
                      <span>PNG</span>
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
            <span class="shrink-0">Ratio</span>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="100"
                bind:value={resizeRatio}
                oninput={(e) =>
                  handleRatioChange(Number(e.currentTarget.value))}
                disabled={pending}
                class="w-full accent-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <span class="w-10 shrink-0 text-right tabular-nums text-slate-400"
                >{resizeRatio}%</span
              >
            </div>
            <span class="shrink-0">Dimensions</span>
            <div class="flex items-center gap-3">
              <input
                type="number"
                min="1"
                aria-label="Resize width"
                value={resizeWidth}
                oninput={(e) =>
                  handleWidthChange(Number(e.currentTarget.value))}
                disabled={pending}
                class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center text-slate-100 outline-none transition focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <span class="text-slate-600">&times;</span>
              <input
                type="number"
                min="1"
                aria-label="Resize height"
                value={resizeHeight}
                oninput={(e) =>
                  handleHeightChange(Number(e.currentTarget.value))}
                disabled={pending}
                class="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center text-slate-100 outline-none transition focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>
            <span class="shrink-0">Rotation</span>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                aria-label="No rotation"
                onclick={() => handleRotationChange(0)}
                disabled={pending}
                class="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 {rotation ===
                0
                  ? 'border-cyan-500 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-500 hover:text-cyan-200'}"
              >
                <span>None</span>
              </button>
              <button
                type="button"
                aria-label="Rotate 90 degrees"
                onclick={() => handleRotationChange(90)}
                disabled={pending}
                class="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 {rotation ===
                90
                  ? 'border-cyan-500 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-500 hover:text-cyan-200'}"
              >
                <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fill-rule="evenodd"
                    d="M9.25 3a.75.75 0 0 1 .75.75V5a5 5 0 1 1-4.462 2.742.75.75 0 0 1 1.34.674A3.5 3.5 0 1 0 10 6.5V7.75a.75.75 0 0 1-1.28.53l-2.5-2.5a.75.75 0 0 1 0-1.06l2.5-2.5A.75.75 0 0 1 10 2.75V3.5a.75.75 0 0 1-.75-.5Z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span>90°</span>
              </button>
              <button
                type="button"
                aria-label="Rotate 180 degrees"
                onclick={() => handleRotationChange(180)}
                disabled={pending}
                class="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 {rotation ===
                180
                  ? 'border-cyan-500 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-500 hover:text-cyan-200'}"
              >
                <svg class="h-4 w-4 rotate-180" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fill-rule="evenodd"
                    d="M9.25 3a.75.75 0 0 1 .75.75V5a5 5 0 1 1-4.462 2.742.75.75 0 0 1 1.34.674A3.5 3.5 0 1 0 10 6.5V7.75a.75.75 0 0 1-1.28.53l-2.5-2.5a.75.75 0 0 1 0-1.06l2.5-2.5A.75.75 0 0 1 10 2.75V3.5a.75.75 0 0 1-.75-.5Z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span>180°</span>
              </button>
              <button
                type="button"
                aria-label="Rotate 270 degrees"
                onclick={() => handleRotationChange(270)}
                disabled={pending}
                class="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 {rotation ===
                270
                  ? 'border-cyan-500 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-cyan-500 hover:text-cyan-200'}"
              >
                <svg class="h-4 w-4 -scale-x-100" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fill-rule="evenodd"
                    d="M9.25 3a.75.75 0 0 1 .75.75V5a5 5 0 1 1-4.462 2.742.75.75 0 0 1 1.34.674A3.5 3.5 0 1 0 10 6.5V7.75a.75.75 0 0 1-1.28.53l-2.5-2.5a.75.75 0 0 1 0-1.06l2.5-2.5A.75.75 0 0 1 10 2.75V3.5a.75.75 0 0 1-.75-.5Z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span>270°</span>
              </button>
            </div>
            <span class="shrink-0">Quality</span>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="100"
                bind:value={resizeQuality}
                disabled={pending}
                class="w-full accent-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
              />
              <span class="w-10 shrink-0 text-right tabular-nums text-slate-400"
                >{resizeQuality}%</span
              >
            </div>
          </div>
        </div>
      {/if}
      <p class="mt-2 min-h-5 text-sm text-rose-300">{errorText}</p>
      <div class="mt-6 flex flex-wrap items-center justify-end gap-3">
        <button
          onclick={onCancel}
          disabled={pending}
          type="button"
          class="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >Cancel</button
        >
        <button
          onclick={onCompress}
          disabled={pending}
          type="button"
          class="rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
          >{pending
            ? "Zipping" + (progress !== null ? " (" + progress + "%)" : "...")
            : "Zip"}</button
        >
      </div>
    </section>
  </div>
</div>
