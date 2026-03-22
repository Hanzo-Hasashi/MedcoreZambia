#!/usr/bin/env node
// scripts/dev-server.js
// Local development server.
// Serves /public as static files and proxies /api/* to handler modules.
// Usage: npm run dev
// Then open: http://localhost:3000

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const PORT   = parseInt(process.env.PORT || '3000', 10);
const PUBLIC = path.join(__dirname, '..', 'public');

// MIME types
const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.json':  'application/json',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff2': 'font/woff2',
  '.webp':  'image/webp',
};

// Replace env placeholders in HTML files
function injectEnv(content, filePath) {
  if (!filePath.endsWith('.html')) return content;
  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  || '';
  const supabaseKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return content
    .replace(/__SUPABASE_URL__/g,      supabaseUrl)
    .replace(/__SUPABASE_ANON_KEY__/g, supabaseKey);
}

// Read and buffer the full request body as JSON
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  let pathname   = parsed.pathname;

  // ── CORS preflight (dev only) ─────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  // ── API routes ────────────────────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    const routeName   = pathname.replace('/api/', '').split('/')[0];
    const handlerPath = path.join(__dirname, '..', 'api', `${routeName}.js`);

    if (!fs.existsSync(handlerPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `API route not found: ${routeName}` }));
      return;
    }

    try {
      const body = await readBody(req);

      let statusCode  = 200;
      const respHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
      let responseBody;
      let ended = false;

      const mockRes = {
        status(code)       { statusCode = code; return this; },
        json(data)         { responseBody = data; return this; },
        end(data)          { ended = true; if (data) responseBody = data; return this; },
        setHeader(k, v)    { respHeaders[k] = v; return this; },
        getHeader(k)       { return respHeaders[k]; },
      };

      // Clear require cache for hot-reload
      delete require.cache[require.resolve(handlerPath)];
      const handlerModule = require(handlerPath);
      const handler = typeof handlerModule === 'function' ? handlerModule : handlerModule.default;

      if (typeof handler !== 'function') {
        throw new Error(`${routeName}.js does not export a handler function`);
      }

      req.body  = body;
      req.query = parsed.query;

      await handler(req, mockRes);

      res.writeHead(statusCode, respHeaders);
      res.end(responseBody !== undefined ? JSON.stringify(responseBody) : '');
    } catch (err) {
      console.error(`[api/${routeName}]`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(PUBLIC, pathname.slice(1));

  if (!fs.existsSync(filePath)) {
    // Try index.html fallback, then medcore-v3.html
    const fallbacks = ['index.html', 'medcore-v3.html'].map(f => path.join(PUBLIC, f));
    const fallback  = fallbacks.find(f => fs.existsSync(f));
    if (fallback) {
      const content = fs.readFileSync(fallback, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(injectEnv(content, fallback));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
    return;
  }

  const ext      = path.extname(filePath).toLowerCase();
  const mime     = MIME[ext] || 'application/octet-stream';
  const isBinary = ['.png','.jpg','.ico','.woff2','.webp'].includes(ext);

  res.writeHead(200, { 'Content-Type': mime });

  if (isBinary) {
    res.end(fs.readFileSync(filePath));
  } else {
    const content = fs.readFileSync(filePath, 'utf8');
    res.end(injectEnv(content, filePath));
  }
});

server.listen(PORT, () => {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  console.log(`\n🏥  MedCore dev server → http://localhost:${PORT}`);
  console.log(`   Static:      ${PUBLIC}`);
  console.log(`   Supabase:    ${supaUrl    || '⚠️  NEXT_PUBLIC_SUPABASE_URL not set'}`);
  console.log(`   Anon key:    ${anonKey    ? anonKey.slice(0,20) + '…' : '⚠️  NEXT_PUBLIC_SUPABASE_ANON_KEY not set'}`);
  console.log(`   Admin email: ${process.env.ADMIN_EMAILS || '⚠️  ADMIN_EMAILS not set'}`);
  if (!supaUrl || !anonKey) {
    console.warn('\n   ⚠️  Missing env vars — check your .env.local file\n');
  } else {
    console.log('\n   Press Ctrl+C to stop.\n');
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${PORT} is already in use. Set PORT=XXXX in .env.local or stop the other process.\n`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
