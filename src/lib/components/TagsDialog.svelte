<script lang="ts">
  import { tagChipClassCommon, tagRemoveBtnClass, tagDropdownItemClass } from "./file-manager/tag-colors";

  interface Props {
    show: boolean;
    currentDir: string;
    selectedItems: string[];
    selectedItemNames: string[];
    tagIndexMap: Record<string, number>;
    getAuthHeaders: () => Record<string, string>;
    onClose: () => void;
  }

  let {
    show,
    currentDir,
    selectedItems,
    selectedItemNames,
    tagIndexMap,
    getAuthHeaders,
    onClose,
  }: Props = $props();

  let allTags: Record<string, string[]> = $state({});
  let pending = $state(false);
  let tagInput = $state("");
  let selectedTags: string[] = $state([]);
  let tagDropdownOpen = $state(false);
  let errorText = $state("");
  let tagInputRef = $state<HTMLInputElement | null>(null);
  let tagContainerRef = $state<HTMLDivElement | null>(null);
  let initialTags: string[] = [];
  let tagsReady = $state(false);

  $effect(() => {
    if (show && !tagsReady) {
      loadTags();
    }
    if (!show) {
      tagsReady = false;
      selectedTags = [];
      tagInput = "";
      initialTags = [];
    }
  });

  function computeItemTags(): string[] {
    const all = new Set<string>();
    for (const item of selectedItems) {
      const filename = item.split("/").pop() ?? item;
      for (const [tag, filenames] of Object.entries(allTags)) {
        if (filenames.includes(filename)) all.add(tag);
      }
    }
    return [...all].sort();
  }

  async function loadTags() {
    const query = new URLSearchParams({ dir: currentDir });
    try {
      const response = await fetch("/api/tags?" + query.toString(), {
        headers: getAuthHeaders(),
      });
      if (!response.ok) return;
      const data = await response.json();
      allTags = data.tags ?? {};
      initialTags = computeItemTags();
      selectedTags = [...initialTags];
      tagsReady = true;
    } catch {}
  }

  function getItemTags(item: string): string[] {
    const filename = item.split("/").pop() ?? item;
    const result: string[] = [];
    for (const [tag, filenames] of Object.entries(allTags)) {
      if (filenames.includes(filename)) result.push(tag);
    }
    return result.sort();
  }

  const commonTags = $derived.by(() => {
    if (!selectedItems.length) return [];
    const itemsTags = selectedItems.map((item) => {
      const set = new Set(getItemTags(item));
      return set;
    });
    const common = new Set<string>();
    if (itemsTags.length > 0) {
      for (const tag of itemsTags[0]) {
        if (itemsTags.every((s) => s.has(tag))) {
          common.add(tag);
        }
      }
    }
    return [...common].sort();
  });


  const existingTagNames = $derived(Object.keys(allTags).sort());

  const filteredTags = $derived.by(() => {
    const query = tagInput.trim().toLowerCase();
    if (!query) return existingTagNames;
    return existingTagNames.filter((t) => t.toLowerCase().includes(query));
  });

  function toggleTagSelection(tag: string) {
    const idx = selectedTags.findIndex((t) => t.toLowerCase() === tag.toLowerCase());
    if (idx !== -1) {
      selectedTags = selectedTags.filter((_, i) => i !== idx);
    } else {
      selectedTags = [...selectedTags, tag];
    }
  }

  function removeSelectedTag(tag: string) {
    selectedTags = selectedTags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
  }

  const hasChanges = $derived.by(() => {
    if (!tagsReady) return false;
    const customTags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
    const finalTags = [...new Set([...selectedTags, ...customTags])].sort();
    const effectiveToAdd = finalTags.filter((t) => !initialTags.includes(t));
    const effectiveToRemove = initialTags.filter((t) => !finalTags.includes(t) && commonTags.includes(t));
    return effectiveToAdd.length > 0 || effectiveToRemove.length > 0;
  });

  async function saveTags() {
    const customTags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
    const finalTags = [...new Set([...selectedTags, ...customTags])].sort();
    const tagsToAdd = finalTags.filter((t) => !initialTags.includes(t));
    const tagsToRemove = initialTags.filter((t) => !finalTags.includes(t) && commonTags.includes(t));
    if (!tagsToAdd.length && !tagsToRemove.length) return;
    pending = true;
    errorText = "";
    const query = new URLSearchParams({ dir: currentDir });
    try {
      if (tagsToRemove.length) {
        const res = await fetch("/api/tags?" + query.toString(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ action: "remove", items: selectedItems, tags: tagsToRemove }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errorText = data.error ?? "Failed to remove tags";
          return;
        }
      }
      if (tagsToAdd.length) {
        const res = await fetch("/api/tags?" + query.toString(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...getAuthHeaders(),
          },
          body: JSON.stringify({ action: "add", items: selectedItems, tags: tagsToAdd }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errorText = data.error ?? "Failed to add tags";
          return;
        }
      }
      selectedTags = [];
      tagInput = "";
      tagDropdownOpen = false;
      onClose();
    } catch {
      errorText = "Failed to save tags";
    } finally {
      pending = false;
    }
  }

  $effect(() => {
    if (!tagDropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (tagContainerRef && !tagContainerRef.contains(e.target as Node)) {
        tagDropdownOpen = false;
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && !pending && show) onClose();
  }}
/>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 bg-slate-950/80 px-4 py-6" onclick={onClose}>
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
          onclick={onClose}
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
          Tags
        </p>
        <h2 class="mt-3 text-2xl font-semibold tracking-tight text-slate-100">
          Edit Tags
        </h2>
        <p class="mt-1 text-sm text-slate-400">
          {selectedItems.length} item{selectedItems.length !== 1 ? "s" : ""} selected
        </p>

        <div class="mt-5">
          <div class="relative" bind:this={tagContainerRef}>
            <div
              class="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm transition focus-within:border-cyan-500"
              onclick={() => tagInputRef?.focus()}
            >
              {#each selectedTags as tag}
                {@const isCommon = commonTags.includes(tag)}
                <span class={tagChipClassCommon(tag, isCommon, tagIndexMap)}>
                  {tag}
                  <button
                    type="button"
                    aria-label="Remove {tag}"
                    onclick={() => removeSelectedTag(tag)}
                    disabled={pending}
                    class={tagRemoveBtnClass(tag, isCommon, tagIndexMap)}
                  >
                    <svg class="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor"
                      ><path
                        d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
                      /></svg
                    >
                  </button>
                </span>
              {/each}
              <input
                bind:value={tagInput}
                bind:this={tagInputRef}
                type="text"
                placeholder={selectedTags.length ? "" : "Select or type tags..."}
                disabled={pending}
                onfocus={() => { tagDropdownOpen = true; }}
                oninput={() => { tagDropdownOpen = true; }}
                onkeydown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (tagInput.trim()) {
                      const match = filteredTags.find(
                        (t) => t.toLowerCase() === tagInput.trim().toLowerCase(),
                      );
                      if (match && !selectedTags.includes(match)) {
                        toggleTagSelection(match);
                      } else if (!match) {
                        toggleTagSelection(tagInput.trim());
                      }
                      tagInput = "";
                    }
                  }
                  if (e.key === "Backspace" && !tagInput && selectedTags.length) {
                    removeSelectedTag(selectedTags[selectedTags.length - 1]);
                  }
                  if (e.key === "Escape") {
                    tagDropdownOpen = false;
                  }
                }}
                class="min-w-[60px] flex-1 bg-transparent py-1 text-sm text-slate-100 outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
              />
            </div>
            {#if tagDropdownOpen && filteredTags.length > 0}
              <div
                class="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/95 p-1 shadow-2xl shadow-slate-950/60 backdrop-blur"
              >
                {#each filteredTags as tag}
                  {@const isCommon = commonTags.includes(tag)}
                  {@const isSelected = selectedTags.includes(tag)}
                  <button
                    type="button"
                    onclick={() => {
                      toggleTagSelection(tag);
                      tagInput = "";
                      tagInputRef?.focus();
                    }}
                    class={tagDropdownItemClass(tag, isSelected, isCommon, tagIndexMap)}
                  >
                    {#if isSelected}
                      <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor"
                        ><path
                          fill-rule="evenodd"
                          d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                          clip-rule="evenodd"
                        /></svg
                      >
                    {/if}
                    <span class="truncate">{tag}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          <div class="mt-3 flex items-center gap-2">
            <button
              onclick={saveTags}
              disabled={pending || (!selectedTags.length && !tagInput.trim()) || !tagsReady}
              type="button"
              class="rounded-lg bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>



        <p class="mt-2 min-h-5 text-sm text-rose-300">{errorText}</p>
      </section>
    </div>
  </div>
{/if}
