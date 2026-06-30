import { sveltekit } from '@sveltejs/kit/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const httpsEnabled = env.HTTP_SCHEME === 'https' || env['http-scheme'] === 'https';
  const isTest = process.env.VITEST === 'true';
  let plugins = isTest
    ? [svelte({ compilerOptions: { dev: true } }), tailwindcss()]
    : [sveltekit(), tailwindcss()];
  let preview = {
    allowedHosts: ['.duckdns.org']
  };
  if (httpsEnabled) {
    const basicSsl = (await import('@vitejs/plugin-basic-ssl')).default;
    plugins.unshift(basicSsl() as any);
  }
  return {
    plugins,
    preview,
    resolve: isTest ? { conditions: ['browser', 'default'] } : undefined,
    test: {
      include: ['src/**/*.{test,spec}.{ts,js}'],
      environment: 'jsdom',
      globals: true,
    },
  };
});
