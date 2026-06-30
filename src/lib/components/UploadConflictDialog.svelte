<script lang="ts">
  interface Props {
    title: string;
    message: string;
    fileName: string;
    errorText: string;
    onRename: () => void;
    onOverwrite: () => void;
    onCancel: () => void;
  }

  let { title, message, fileName = $bindable(), errorText, onRename, onOverwrite, onCancel }: Props = $props();
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onCancel(); }} />

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
        class="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
      >
        <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"
          ><path
            d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
          /></svg>
      </button>
      <p class="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Upload Conflict</p>
      <h2 class="mt-3 text-2xl font-semibold tracking-tight text-slate-100">{title}</h2>
      <p class="mt-3 text-sm leading-6 text-slate-400">{message}</p>
      <label class="mt-5 block text-sm text-slate-300">
        <span class="mb-2 block">New filename</span>
        <input bind:value={fileName} type="text" class="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500" />
      </label>
      <p class="mt-2 min-h-5 text-sm text-rose-300">{errorText}</p>
      <div class="mt-6 flex flex-wrap justify-end gap-3">
        <button onclick={onCancel} type="button" class="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-100">Cancel</button>
        <button onclick={onRename} type="button" class="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-semibold text-cyan-200 transition hover:border-cyan-400 hover:text-cyan-100">Upload New File</button>
        <button onclick={onOverwrite} type="button" class="rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-rose-400">Overwrite</button>
      </div>
    </section>
  </div>
</div>
