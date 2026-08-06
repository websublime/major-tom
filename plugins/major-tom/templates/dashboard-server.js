#!/usr/bin/env node
// Static server for the Major Tom dashboard (D31). Node, no dependencies.
// Lives in the plugin (never written into the target repo); the /major-tom:dashboard
// command runs it against the dashboard file in the target's persistence root.
//
// Usage: node dashboard-server.js <path-to-dashboard.html | directory> [port]
//
// Given a file: serves that single dashboard file at / (the production path).
// Given a directory: serves the files inside it, path-traversal-safe (the authoring dev
// loop, D34: ES modules need http, file:// blocks them). Still localhost, still GET only.
// Port resolution: explicit argument, else the PORT env var (what the Claude Desktop
// launch.json autoPort mechanism passes when it picks a free port, D32), else 4242.
// Files are read on every request, so edits and re-injects show up on browser refresh.

'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')

const target = process.argv[2]
const port = Number(process.argv[3]) || Number(process.env.PORT) || 4242

if (!target) {
  console.error('usage: node dashboard-server.js <path-to-dashboard.html | directory> [port]')
  process.exit(1)
}
if (!fs.existsSync(target)) {
  console.error(`not found: ${target} (run /major-tom:onboard to generate the dashboard)`)
  process.exit(1)
}
const isDir = fs.statSync(target).isDirectory()
const dirRoot = isDir ? fs.realpathSync(target) : null

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' })
    res.end('method not allowed')
    return
  }
  const url = decodeURIComponent(req.url.split('?')[0])
  if (!isDir) {
    if (url === '/' || url === '/index.html' || url === '/dashboard.html') {
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
      fs.createReadStream(target).pipe(res)
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }
  const relPath = url === '/' ? 'index.html' : url.slice(1)
  const full = path.resolve(dirRoot, relPath)
  if (full !== dirRoot && !full.startsWith(dirRoot + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    res.end('forbidden')
    return
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(full).pipe(res)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`port ${port} is already in use (another dashboard server?); pass a different port`)
    process.exit(1)
  }
  console.error(err.message)
  process.exit(1)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`major-tom dashboard on http://localhost:${port} (serving ${target})`)
})
