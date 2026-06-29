import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const httpsEnabled = env.HTTP_SCHEME === 'https' || env['http-scheme'] === 'https';
  let plugins = [sveltekit(), tailwindcss()];
  let preview = {
    allowedHosts: ['.duckdns.org']
  };
  if (httpsEnabled) {
    const basicSsl = (await import('@vitejs/plugin-basic-ssl')).default;
    plugins.unshift(basicSsl() as any);
  }
  return { plugins, preview };
});
