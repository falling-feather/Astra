import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogPlugin } from './scripts/catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, process.cwd(), '').VITE_BASE_PATH || '/',
  plugins: [catalogPlugin(root)],
  // Preview the self-contained artifact; Vite otherwise inherits the dev proxy.
  preview: { proxy: {} },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:9001', changeOrigin: false },
      '/labs': { target: 'http://127.0.0.1:9001', changeOrigin: false },
    },
  },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'three-core',
              test: /node_modules[\\/]three[\\/]build[\\/]three\.core\.js/,
              priority: 20,
              includeDependenciesRecursively: false,
            },
            {
              name: 'three-webgl',
              test: /node_modules[\\/]three[\\/]/,
              priority: 10,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
}));
