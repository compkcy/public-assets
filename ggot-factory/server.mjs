// 개발/테스트용 정적 서버 (무의존성). 앱 파일만 허용 목록으로 제공한다.
// 주의: localhost는 이 PC만 가리킨다. LAN 주소(http://PC-IP:5173)는 HTTPS가 아니어서 아이폰에서 오프라인(PWA) 기능이 동작하지 않는다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 5173;
const ALLOW = /^(index\.html|style\.css|manifest\.webmanifest|sw\.js|src\/(?!.*\.test\.js$)[\w-]+\.js|icons\/[\w-]+\.png)$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

export function createServer() {
  return http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html'; }
    catch { res.writeHead(400); return res.end(); }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (!ALLOW.test(rel)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(port, '0.0.0.0', () => console.log(`GGOT http://localhost:${port}  (LAN 주소는 테스트 전용, 오프라인 기능은 HTTPS 필요)`));
}
