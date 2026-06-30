<script lang="ts">
  import { tick } from "svelte";

  interface Props {
    title: string;
    message: string;
    folderName: string;
    errorText: string;
    pending: boolean;
    onCreate: () => void;
    onCancel: () => void;
  }

  let {
    title,
    message,
    folderName = $bindable(),
    errorText,
    pending,
    onCreate,
    onCancel,
  }: Props = $props();

  let inputRef = $state<HTMLInputElement | null>(null);

  $effect(() => {
    void title;
    tick().then(() => {
      inputRef?.focus();
    });
  });
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !pending) onCancel(); }} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 bg-slate-950/80 px-4 py-6" onclick={onCancel}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="flex min-h-full items-center justify-center" onclick={(e) => e.stopPropagation()}>
    <section class="relative w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur">
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
          /></svg>
      </button>
      <p class="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">Create Folder</p>
      <h2 class="mt-3 text-2xl font-semibold tracking-tight text-slate-100">{title}</h2>
      <p class="mt-3 text-sm leading-6 text-slate-400">{message}</p>
      <label class="mt-5 block text-sm text-slate-300">
        <span class="mb-2 block">Folder name</span>
        <input
          bind:value={folderName}
          bind:this={inputRef}
          type="text"
          class="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-emerald-500"
          onkeydown={(event) => {
            if (event.key === 'Enter' && !pending) {
              event.preventDefault();
              onCreate();
            }
          }}
        />
      </label>
      <p class="mt-2 min-h-5 text-sm text-rose-300">{errorText}</p>
      <div class="mt-6 flex flex-wrap justify-end gap-3">
        <button onclick={onCancel} disabled={pending} type="button" class="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40">Cancel</button>
        <button onclick={onCreate} disabled={pending} type="button" class="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">{pending ? 'Creating...' : 'Create Folder'}</button>
      </div>
    </section>
  </div>
</div>
