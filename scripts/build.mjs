/**
 * 构建产物：
 *   dist/worker/main.mjs   Orca worker 入口（Node，ESM，打包第三方依赖）
 *   dist/panel/panel.html  面板页面，自带 bundle 与主题变量注入点
 *   dist/panel/panel.js    面板应用（React 自打包，因为 Orca 面板不提供宿主 React）
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { build, context } from 'esbuild'

const rootDir = resolve(import.meta.dirname, '..')
const watch = process.argv.includes('--watch')

const workerOptions = {
  entryPoints: [resolve(rootDir, 'src/worker/main.ts')],
  outfile: resolve(rootDir, 'dist/worker/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info'
}

const panelOptions = {
  entryPoints: [resolve(rootDir, 'src/panel/main.tsx')],
  outfile: resolve(rootDir, 'dist/panel/panel.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  logLevel: 'info'
}

const panelHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>MattWorkflow</title>
    <style>
      html, body, #root { height: 100%; margin: 0; }
      body {
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        font-size: 13px;
        color: var(--orca-foreground, #ddd);
        background: var(--orca-background, transparent);
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script src="./panel.js"></script>
  </body>
</html>
`

await rm(resolve(rootDir, 'dist'), { recursive: true, force: true })
await mkdir(resolve(rootDir, 'dist/panel'), { recursive: true })
await writeFile(resolve(rootDir, 'dist/panel/panel.html'), panelHtml)

if (watch) {
  const worker = await context(workerOptions)
  const panel = await context(panelOptions)
  await worker.watch()
  await panel.watch()
  console.log('watching: worker + panel')
} else {
  await build(workerOptions)
  await build(panelOptions)
  await cp(resolve(rootDir, 'src/panel/theme.css'), resolve(rootDir, 'dist/panel/theme.css'))
  console.log('build ok')
}
