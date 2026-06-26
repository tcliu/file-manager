<script lang="ts">
  interface Props {
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
  }

  let { title, message, confirmLabel, onConfirm, onCancel }: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 bg-slate-950/80 px-4 py-6" onclick={onCancel}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="flex min-h-full items-center justify-center" onclick={(e) => e.stopPropagation()}>
    <section class="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl shadow-slate-950/60 backdrop-blur">
      <p class="text-xs font-semibold uppercase tracking-[0.24em] text-rose-300">Confirm Delete</p>
      <h2 class="mt-3 text-2xl font-semibold tracking-tight text-slate-100">{title}</h2>
      <p class="mt-3 text-sm leading-6 text-slate-400">{message}</p>
      <div class="mt-6 flex flex-wrap justify-end gap-3">
        <button onclick={onCancel} type="button" class="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-slate-100">Cancel</button>
        <button onclick={onConfirm} type="button" class="rounded-2xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-rose-400">{confirmLabel}</button>
      </div>
    </section>
  </div>
</div>
