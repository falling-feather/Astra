import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        welcome: resolve(import.meta.dirname, 'index.html'),
        login: resolve(import.meta.dirname, 'login.html'),
        observatory: resolve(import.meta.dirname, 'observatory.html'),
        experiment: resolve(import.meta.dirname, 'experiment.html'),
      },
    },
  },
});
