import { defineConfig } from 'vite'

export default defineConfig({
  // 关键设置：使用相对路径，确保在 GitHub Pages 子目录下也能运行
  base: './',
  build: {
    // 确保支持现代浏览器特性
    target: 'esnext'
  }
})