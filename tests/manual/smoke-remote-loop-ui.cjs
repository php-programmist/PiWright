const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..', '..', 'resources', 'remote');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const file = req.url === '/' ? 'index.html' : req.url.slice(1).split('?')[0];
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': mime[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForTimeout(300);

  const results = {};

  // CSS: bottom margins present
  results.loopBarMarginBottom = await page.evaluate(() => {
    document.getElementById('loopBar').hidden = false;
    return getComputedStyle(document.getElementById('loopBar')).marginBottom;
  });
  results.loopExitMarginBottom = await page.evaluate(() => {
    const e = document.getElementById('loopExit');
    e.hidden = false;
    return getComputedStyle(e).marginBottom;
  });

  // loopMax hidden when checkbox unchecked
  results.loopMaxHiddenUnchecked = await page.evaluate(() => {
    loopsEnabled = true;
    loopEnabled = false;
    loopInfo = null;
    applyLoopUi();
    return document.getElementById('loopMax').hidden;
  });

  // loopMax visible when checkbox checked
  results.loopMaxVisibleChecked = await page.evaluate(() => {
    loopEnabled = true;
    applyLoopUi();
    return !document.getElementById('loopMax').hidden;
  });

  await browser.close();
  server.close();

  const ok =
    results.loopBarMarginBottom === '8px' &&
    results.loopExitMarginBottom === '8px' &&
    results.loopMaxHiddenUnchecked === true &&
    results.loopMaxVisibleChecked === true;
  console.log(JSON.stringify(results));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
