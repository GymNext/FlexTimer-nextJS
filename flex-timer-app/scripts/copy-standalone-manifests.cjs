/**
 * Copies manifest files from .next/ into .next/standalone/.next/ so Firebase App Hosting
 * adapter can find them (it expects routes-manifest.json and middleware at standalone/.next/).
 * Run after `next build` when using output: 'standalone'.
 */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const dotNext = path.join(root, '.next')
const standaloneNext = path.join(dotNext, 'standalone', '.next')
const standaloneNextServer = path.join(standaloneNext, 'server')

const files = [
  { from: path.join(dotNext, 'routes-manifest.json'), to: path.join(standaloneNext, 'routes-manifest.json') },
  { from: path.join(dotNext, 'server', 'middleware-manifest.json'), to: path.join(standaloneNextServer, 'middleware-manifest.json') },
]

for (const { from, to } of files) {
  if (!fs.existsSync(from)) continue
  const dir = path.dirname(to)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.copyFileSync(from, to)
  console.log('Copied', path.relative(root, from), '->', path.relative(root, to))
}
