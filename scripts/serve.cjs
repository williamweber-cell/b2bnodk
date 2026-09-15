#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   serve.cjs — zero-dependency static server for local development

     node scripts/serve.cjs [port]

   The apps also open straight from disk (file://) — that is deliberate, and
   why the scripts are classic <script> tags rather than ES modules. Serving
   over http:// is still worth it for:

     - a realistic origin, so localStorage behaves as it will in production
       (file:// origins are opaque in some browsers and can drop storage)
     - correct charset headers
     - sharing on the LAN for a demo

   CHARSET: every text response carries "; charset=utf-8" explicitly. Without
   it a browser may sniff latin-1 and render "lønkørsel" as "lÃ¸nkÃ¸rsel" —
   which is exactly the kind of thing that only shows up in front of a
   Danish customer.

   No caching headers, so a reload always picks up an edit.
   ═══════════════════════════════════════════════════════════════════════ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8080;
const DEFAULT_FILE = 'invoicery-business.html';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.cjs':  'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md':   'text/markdown; charset=utf-8',
  '.svg':  'image/svg+xml; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2'
};

const green = s => `\x1b[32m${s}\x1b[0m`;
const dim   = s => `\x1b[2m${s}\x1b[0m`;
const bold  = s => `\x1b[1m${s}\x1b[0m`;
const red   = s => `\x1b[31m${s}\x1b[0m`;

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/' + DEFAULT_FILE;

  // Resolve inside ROOT only — never serve outside the project.
  const target = path.resolve(ROOT, '.' + urlPath);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      console.log(dim(`  404  ${req.method} ${urlPath}`));
      return res.end('Not found: ' + urlPath);
    }

    const type = TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store, must-revalidate'
    });
    console.log(dim(`  200  ${req.method} ${urlPath}  ${stat.size}B`));
    fs.createReadStream(target).pipe(res);
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(red(`\n  Port ${PORT} is already in use.`));
    console.error(`  Try another: ${bold('node scripts/serve.cjs 8081')}\n`);
    process.exit(1);
  }
  throw e;
});

function lanAddress() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

server.listen(PORT, () => {
  const lan = lanAddress();
  console.log('');
  console.log(bold('  Invoicery Business — local server'));
  console.log('');
  console.log(`  Portal   ${green(`http://localhost:${PORT}/invoicery-business.html`)}`);
  console.log(`  Admin    ${green(`http://localhost:${PORT}/invoicery-business-admin.html`)}`);
  if (lan) console.log(`  LAN      ${dim(`http://${lan}:${PORT}/`)}  ${dim('(same Wi-Fi, for demos)')}`);
  console.log('');
  console.log(dim('  Market switch is in the top nav (portal) and the sidebar (admin).'));
  console.log(dim('  Reset demo data from the console:  IB.resetDemo(); location.reload()'));
  console.log(dim('  Ctrl+C to stop.'));
  console.log('');
});
