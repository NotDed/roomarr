import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    /* Two projects, because they have genuinely different needs.

       `core` is where every interesting bug in this project lives — the
       rasterizer, the distance transform, the erosion threshold, the optimizer.
       It runs in plain node with no DOM at all, which keeps it fast enough that
       property tests with a few hundred runs stay comfortable, and makes it
       impossible for a core test to accidentally depend on a browser API.

       `ui` gets happy-dom. There will be very few of these on purpose: the
       pure core is where the risk is, and rendering assertions mostly test
       React rather than roomarr. */
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          environment: 'node',
          include: ['src/core/**/*.test.ts', 'src/workers/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'happy-dom',
          include: ['src/{ui,render,state,print}/**/*.test.{ts,tsx}'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      reporter: ['text', 'html'],
    },
  },
});
