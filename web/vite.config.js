import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'astra-public-lab-directory-index',
    configureServer(server) {
      // Vite checks publicDir for files, but applies its HTML fallback against root.
      server.middlewares.use((req, _res, next) => {
        const directory = /^(\/labs\/(?:[\w-]+\/)*)(\?.*)?$/.exec(req.url ?? '');
        if (directory && existsSync(resolve(server.config.publicDir, '.' + directory[1], 'index.html'))) {
          req.url = directory[1] + 'index.html' + (directory[2] || '');
        }
        next();
      });
    },
  }],
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
