import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/color-mix-lab/',
  plugins: [react()],
})