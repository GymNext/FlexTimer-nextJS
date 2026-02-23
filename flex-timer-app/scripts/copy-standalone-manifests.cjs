/**
 * Copies manifest files from .next/ into .next/standalone/.next/ so Firebase App Hosting
 * adapter can find them. Also patches server.js to listen on 0.0.0.0 for Cloud Run.
 * Run after `next build` when using output: 'standalone'.
 */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const dotNext = path.join(root, '.next')
const standaloneDir = path.join(dotNext, 'standalone')
const standaloneNext = path.join(standaloneDir, '.next')
const standaloneNextServer = path.join(standaloneNext, 'server')
const serverJsPath = path.join(standaloneDir, 'server.js')

// Copy manifests
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

// Force server.js to listen on 0.0.0.0 (Cloud Run requires all interfaces)
if (fs.existsSync(serverJsPath)) {
  let content = fs.readFileSync(serverJsPath, 'utf8')
  const patch = "process.env.HOSTNAME = process.env.HOSTNAME || '0.0.0.0';\n"
  if (content.startsWith('#!')) {
    const firstLineEnd = content.indexOf('\n') + 1
    content = content.slice(0, firstLineEnd) + patch + content.slice(firstLineEnd)
  } else {
    content = patch + content
  }
  fs.writeFileSync(serverJsPath, content)
  console.log('Patched server.js to default HOSTNAME=0.0.0.0')
}
