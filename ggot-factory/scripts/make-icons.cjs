// 앱 아이콘 PNG 생성 (Playwright Chromium 캔버스 사용). 실행: npm run icons
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const browser = await chromium.launch(), page = await browser.newPage();
  const out = path.join(__dirname, '..', 'icons');
  for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['icon-maskable-512', 512, 0.12], ['apple-touch-icon', 180, 0]]) {
    const b64 = await page.evaluate(([size, pad]) => {
      const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
      g.fillStyle = '#7B4DFF'; g.fillRect(0, 0, size, size);
      const s = size * (1 - pad * 2), o = size * pad;
      // 공장 실루엣(톱니 지붕) + 체크 표시
      g.fillStyle = '#D4FF3F';
      const x = o + s * 0.16, y = o + s * 0.30, w = s * 0.68, h = s * 0.44;
      g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + h * 0.35);
      for (let i = 0; i < 3; i++) { const sx = x + (w / 3) * i; g.lineTo(sx + w / 3, y); g.lineTo(sx + w / 3, y + h * 0.35); }
      g.lineTo(x + w, y + h); g.closePath(); g.fill();
      g.strokeStyle = '#7B4DFF'; g.lineWidth = s * 0.07; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(x + w * 0.28, y + h * 0.68); g.lineTo(x + w * 0.45, y + h * 0.84); g.lineTo(x + w * 0.74, y + h * 0.5); g.stroke();
      g.fillStyle = '#fff'; g.font = `800 ${Math.round(s * 0.14)}px sans-serif`; g.textAlign = 'center';
      g.fillText('GGOT', o + s / 2, o + s * 0.92);
      return c.toDataURL('image/png').split(',')[1];
    }, [size, pad]);
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(b64, 'base64'));
    console.log('icons/' + name + '.png');
  }
  await browser.close();
})();
