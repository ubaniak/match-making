import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the site from /match-making/, so production builds need that base path.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/match-making/' : '/',
}))
