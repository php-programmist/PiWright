const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 640 },
    deviceScaleFactor: 2,
  });
  await page.goto('file:///D:/Projects/piwright/scripts/social-preview.html');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/Projects/piwright/docs/social-preview.png' });
  await browser.close();
  console.log('done');
})();
