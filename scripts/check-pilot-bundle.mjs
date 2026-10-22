import { build } from 'vite';
import { fileURLToPath } from 'node:url';
await build({
  configFile: false,
  build: {
    outDir: '.cache/pilot-dependency-build',
    lib: {
      entry: fileURLToPath(new URL('./pilot-browser-entry.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'pilot',
    },
  },
});
