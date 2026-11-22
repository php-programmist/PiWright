/* Manual smoke: remote header layout — sync dot above, new-session button below.
   Serves resources/remote over local HTTP (WS will fail; static header is what we check). */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const root = path.join(__dirname, "..", "..", "resources", "remote");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".ico": "image/x-icon" };

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  const file = url === "/" ? "index.html" : url.slice(1);
  const full = path.join(root, file);
  if (!fs.existsSync(full)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(full)] || "application/octet-stream" });
  fs.createReadStream(full).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(500);
  const box = await page.evaluate(() => {
    const dot = document.getElementById("dot").getBoundingClientRect();
    const btn = document.getElementById("newSession").getBoundingClientRect();
    const side = document.querySelector(".side").getBoundingClientRect();
    const header = document.querySelector("header").getBoundingClientRect();
    return {
      dotAboveButton: dot.bottom <= btn.top,
      sameColumn: Math.abs((dot.left + dot.right) / 2 - (btn.left + btn.right) / 2) < 2,
      sideInsideHeader: side.top >= header.top && side.bottom <= header.bottom + 1,
      noHorizScroll: document.documentElement.scrollWidth <= window.innerWidth,
      dot: { t: dot.top, b: dot.bottom, l: dot.left, r: dot.right },
      btn: { t: btn.top, b: btn.bottom, l: btn.left, r: btn.right },
      headerH: header.height,
    };
  });
  console.log(JSON.stringify(box, null, 2));
  await page.screenshot({ path: path.join(__dirname, "remote-header.png") });
  await browser.close();
  server.close();
  const ok = box.dotAboveButton && box.sameColumn && box.sideInsideHeader && box.noHorizScroll;
  console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
