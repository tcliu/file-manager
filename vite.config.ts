import basicSsl from '@vitejs/plugin-basic-ssl';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [basicSsl(), sveltekit(), tailwindcss()],
  preview: {
    allowedHosts: ['.duckdns.org'],
    https: {}
  }
});
