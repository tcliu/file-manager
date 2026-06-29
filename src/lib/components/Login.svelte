<script lang="ts">
  import { onMount } from 'svelte';

  const REMEMBER_ME_STORAGE_KEY = 'file-manager-remembered-login';

  interface Props {
    username: string;
    password: string;
    rememberMe: boolean;
    passwordVisible: boolean;
    loginStatusText: string;
    loginPending: boolean;
    onLogin: () => void;
  }

  let {
    username = $bindable(),
    password = $bindable(),
    rememberMe = $bindable(),
    passwordVisible = $bindable(),
    loginStatusText = $bindable(),
    loginPending = $bindable(),
    onLogin,
  }: Props = $props();

  onMount(() => {
    const saved = localStorage.getItem(REMEMBER_ME_STORAGE_KEY);
    if (saved) {
      try {
        const { username: u, password: p } = JSON.parse(saved);
        username = u;
        password = atob(p);
        rememberMe = true;
      } catch {}
    }
  });

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (rememberMe) {
      localStorage.setItem(REMEMBER_ME_STORAGE_KEY, JSON.stringify({
        username,
        password: btoa(password),
      }));
    } else {
      localStorage.removeItem(REMEMBER_ME_STORAGE_KEY);
    }
    onLogin();
  }
</script>

<div class="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
  <div
    class="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center justify-center"
  >
    <section
      class="w-full rounded-xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl shadow-slate-950/50"
    >
      <div class="mb-6">
        <h1 class="text-3xl font-semibold tracking-tight text-slate-100">
          File Manager
        </h1>
        <p class="mt-2 text-sm text-slate-400">
          Sign in to access the file browser.
        </p>
      </div>
      <form onsubmit={handleSubmit} class="space-y-4">
        <label class="block text-sm text-slate-300">
          <span class="mb-2 block">Username</span>
          <input
            bind:value={username}
            name="username"
            type="text"
            autocomplete="username"
            class="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500"
            required
          />
        </label>
        <label class="block text-sm text-slate-300">
          <span class="mb-2 block">Password</span>
          <div class="relative">
            <input
              bind:value={password}
              type={passwordVisible ? "text" : "password"}
              name="password"
              autocomplete="current-password"
              class="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 pr-14 text-slate-100 outline-none transition focus:border-cyan-500"
              required
            />
            <button
              onclick={() => (passwordVisible = !passwordVisible)}
              aria-label={passwordVisible ? "Hide password" : "Show password"}
              type="button"
              class="absolute inset-y-0 right-2 my-2 inline-flex w-10 items-center justify-center rounded-md text-slate-300 transition hover:bg-slate-800 hover:text-cyan-300"
            >
              {#if passwordVisible}
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"
                  ><path
                    d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l1.845 1.845A8.977 8.977 0 0 0 1.6 9.697a1 1 0 0 0 0 .606 8.02 8.02 0 0 0 12.513 4.152l2.607 2.607a.75.75 0 1 0 1.06-1.06l-14.5-14.5Zm7.63 7.63a2.75 2.75 0 0 1-3.76-3.76l3.76 3.76Zm2.128 2.128A6.52 6.52 0 0 1 3.1 10a7.49 7.49 0 0 1 2.04-3.205l1.036 1.036a4.25 4.25 0 0 0 6 6l.862.862Zm1.822-1.822-1.03-1.03a4.25 4.25 0 0 0-5.956-5.956l-1.03-1.03A8.018 8.018 0 0 1 18.4 9.697a1 1 0 0 1 0 .606 7.934 7.934 0 0 1-3.54 3.853Z"
                  /></svg
                >
              {:else}
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"
                  ><path
                    d="M1.6 10.303a1 1 0 0 1 0-.606 8.02 8.02 0 0 1 14.8-1.98.75.75 0 1 1-1.298.752 6.52 6.52 0 0 0-12.002 1.531 6.52 6.52 0 0 0 12.002 1.531.75.75 0 0 1 1.298.752 8.02 8.02 0 0 1-14.8-1.98Z"
                  /><path
                    d="M10 7.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z"
                  /></svg
                >
              {/if}
            </button>
          </div>
        </label>
        <label class="flex items-center gap-3 text-sm text-slate-300">
          <input
            bind:checked={rememberMe}
            name="rememberMe"
            type="checkbox"
            class="h-4 w-4 rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-cyan-500"
          />
          <span>Remember me</span>
        </label>
        <button
          disabled={loginPending}
          type="submit"
          class="w-full rounded-lg bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
        >
          {loginPending ? "Signing in..." : "Login"}
        </button>
        <p class="min-h-5 text-sm text-rose-300">{loginStatusText}</p>
      </form>
    </section>
  </div>
</div>
