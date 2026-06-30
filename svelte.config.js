import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ runtime: 'nodejs24.x', external: ['sharp'] })
  }
};

export default config;
