'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

/** 本地预览端口可通过环境变量调整，不影响静态部署。 */
const PORT = Number(process.env.SPROUT_PORT || 8787);
/** 可模拟 GitHub Pages 的仓库子路径，例如 /raz/。 */
const BASE = '/' + (process.env.SPROUT_BASE_PATH || '').split('/').filter(Boolean).join('/') + '/';
const basePath = BASE === '//' ? '/' : BASE;
const root = __dirname;
/** 预览仅服务发布文件，不暴露原始 PDF、脚本及隐藏目录。 */
const allowedRoots = new Set(['index.html', 'styles.css', 'app.js', 'core.js', 'assets', 'data']);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon' };

/** 输出简单 HTTP 错误，不回显本机文件路径。 */
function error(response, status, text) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}

/** 提供静态资源和音频范围请求，保持浏览器拖动播放的行为。 */
function serve(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(response, 405, 'Method not allowed');
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch (exception) { return error(response, 400, 'Invalid URL'); }
  if (basePath !== '/' && pathname === basePath.slice(0, -1)) {
    response.writeHead(302, { Location: basePath }); response.end(); return;
  }
  if (!pathname.startsWith(basePath)) return error(response, 404, 'Not found');
  const relative = pathname.slice(basePath.length) || 'index.html';
  const parts = relative.split(/[\\/]/);
  if (!allowedRoots.has(parts[0]) || parts.some(part => part.startsWith('.') || part === '..')) return error(response, 404, 'Not found');
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep)) return error(response, 403, 'Forbidden');
  fs.stat(filename, (exception, stat) => {
    if (exception || !stat.isFile()) return error(response, 404, 'Not found');
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    const headers = { 'Content-Type': contentTypes[path.extname(filename)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    if (request.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
      if (!range) return error(response, 416, 'Invalid range');
      start = Number(range[1]); end = range[2] ? Number(range[2]) : end;
      if (start > end || end >= stat.size) return error(response, 416, 'Invalid range');
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      status = 206;
    }
    headers['Content-Length'] = end - start + 1;
    response.writeHead(status, headers);
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = fs.createReadStream(filename, { start, end });
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
}

const server = http.createServer(serve);
server.listen(PORT, '127.0.0.1', () => console.log(`Little Sprout: http://127.0.0.1:${PORT}${basePath}`));
server.on('error', exception => { console.error(exception.message); process.exitCode = 1; });
