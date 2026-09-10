import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  assetsInclude: ['**/*.JPG', '**/*.JPEG', '**/*.PNG', '**/*.GIF'],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('pdfjs-dist') || id.includes('jspdf') || id.includes('html2canvas')) return 'pdf-vendor'
          if (id.includes('firebase')) return 'firebase-vendor'
          if (id.includes('@stripe')) return 'stripe-vendor'
          if (id.includes('react')) return 'react-vendor'
          if (id.includes('signature_pad') || id.includes('axios')) return 'util-vendor'
        },
      },
    },
  },
})
