import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Три входа main: приложение (out/main/index.js), демон фоновых сессий (out/daemon/index.js)
  // и headless-сервер веб-режима (out/headless/index.js). outDir 'out' — иначе относительные
  // имена легли бы внутрь out/main.
  main: {
    build: {
      outDir: 'out',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          daemon: resolve(__dirname, 'src/main/daemon/index.ts'),
          headless: resolve(__dirname, 'src/main/headless/index.ts')
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'daemon' ? 'daemon/index.js' : chunk.name === 'headless' ? 'headless/index.js' : 'main/index.js',
          chunkFileNames: 'chunks/[name]-[hash].js'
        }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react()]
  }
})
