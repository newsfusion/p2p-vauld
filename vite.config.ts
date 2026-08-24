import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import webExtension from 'vite-plugin-web-extension';
import { resolve } from 'path';
import {
  isDemoManifestModeEnabled,
  transformExtensionManifest,
} from './src/shared/manifest-transform';

export default defineConfig(({ command, mode }) => {
  if (command === 'serve') {
    // MV3 forbids the remote HMR scripts injected by Vite's dev server.
    throw new Error('Vite serve mode is not supported for this extension. Use `pnpm dev`.');
  }

  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
      webExtension({
        manifest: resolve(__dirname, 'manifest.json'),
        transformManifest: (manifest) =>
          transformExtensionManifest(
            manifest,
            isDemoManifestModeEnabled(process.env.VITE_DEMO_MODE),
          ),
        additionalInputs: ['dashboard.html', 'offscreen.html', 'popup.html'],
        disableAutoLaunch: true,
        skipManifestValidation: true,
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      minify: mode === 'production',
      sourcemap: mode !== 'production',
    },
  };
});
