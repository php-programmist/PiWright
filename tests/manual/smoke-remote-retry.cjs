/* Manual smoke: remote start retry. Holds remote.port busy, checks Settings shows the start
   error + Retry button, releases the port and checks the bridge comes up on its own (auto-backoff),
   with no re-toggle of the switch. SMOKE_CDP=http://localhost:9223 SMOKE_PORT=7699. */
const net = require("net");
const path = require("path");
const { chromium } = require("playwright-core");

const CDP = process.env.SMOKE_CDP || "http://localhost:9223";
const PORT = Number(process.env.SMOKE_PORT || 7699);

const ERROR_SELECTOR = ".settings-section .settings-error";

function holdPort(port) {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

async function closeSettings(page) {
  await page.evaluate(() => {
    const ov = document.querySelector(".settings-modal-overlay");
    if (ov) ov.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await page.waitForSelector(".settings-modal-overlay", { state: "detached", timeout: 5000 });
}

async function setRemote(page, patch) {
  await page.evaluate(async (p) => {
    const s = await window.piwright.getSettings();
    await window.piwright.setSettings({
      notifications: { ...s.notifications, remote: { ...s.notifications.remote, ...p } },
    });
  }, patch);
}

function remoteStatus(page) {
  return page.evaluate(() => window.piwright.remoteStatus());
}

function measure(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const box = el.getBoundingClientRect();
    const parent = el.parentElement.getBoundingClientRect();
    const btn = el.querySelector("button");
    return {
      found: true,
      text: el.textContent.trim(),
      retry: btn ? btn.textContent.trim() : null,
      fits: el.scrollWidth <= el.clientWidth + 1 && box.right <= parent.right + 1,
    };
  }, selector);
}

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages()[0];
  let holder = null;
  try {
    await closeSettings(page);
    await setRemote(page, { enabled: false });
    await page.waitForTimeout(500);
    holder = await holdPort(PORT);
    await setRemote(page, { enabled: true, port: PORT });
    // настройки менялись мимо renderer-стора — перезагружаем окно, чтобы draft их подхватил
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector('.panel-foot button.icon', { timeout: 30000 });

    await page.click('.panel-foot button.icon[title="Settings"], .panel-foot button.icon[title="Настройки"]');
    await page.waitForSelector("h3:has-text('Remote')");

    // первый опрос статуса — через 1.2 с после открытия настроек, ждём появления ошибки старта
    await page.waitForSelector(ERROR_SELECTOR, { timeout: 15000 });
    const busy = await measure(page, ERROR_SELECTOR);
    console.log("busy state:", JSON.stringify(busy));

    await page.evaluate((sel) => document.querySelector(`${sel} button`).click(), ERROR_SELECTOR);
    await page.waitForTimeout(1500);
    const afterRetry = await remoteStatus(page);
    const stillBusy = await measure(page, ERROR_SELECTOR);
    console.log("after Retry while busy:", JSON.stringify(afterRetry), JSON.stringify(stillBusy));

    await holder.close();
    holder = null;

    await page.waitForFunction(
      (port) =>
        [...document.querySelectorAll(".settings-section .panel-hint")].some((n) => n.textContent.includes(String(port))),
      PORT,
      { timeout: 30000 }
    );
    const hint = await page.evaluate((port) => {
      const el = [...document.querySelectorAll(".settings-section .panel-hint")].find((n) =>
        n.textContent.includes(String(port))
      );
      if (!el) return { found: false, text: null, fits: false };
      const box = el.getBoundingClientRect();
      const parent = el.parentElement.getBoundingClientRect();
      return {
        found: true,
        text: el.textContent.trim(),
        fits: el.scrollWidth <= el.clientWidth + 1 && box.right <= parent.right + 1,
      };
    }, PORT);
    const up = await remoteStatus(page);
    console.log("after port released:", JSON.stringify(up), JSON.stringify(hint));

    await page.screenshot({ path: path.join(__dirname, "remote-retry.png") });

    const ok =
      busy.found &&
      busy.retry !== null &&
      busy.retry.length > 0 &&
      busy.fits &&
      busy.text.includes(String(PORT)) &&
      afterRetry.running === false &&
      stillBusy.found &&
      up.running === true &&
      up.error === null &&
      hint.found &&
      hint.fits;
    console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (holder !== null) holder.close();
    try {
      await closeSettings(page);
      await setRemote(page, { enabled: false });
    } catch {
      // окно уже закрыто
    }
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
