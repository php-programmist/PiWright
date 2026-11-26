/* Manual smoke: phone-bridge login must render, not download. Reproduces the Chrome
   Android report: POST /login → 303 → GET / served as application/octet-stream made
   the browser download the page («Без названия»). Drives real Chrome through the full
   form flow and asserts: no download event, document.contentType text/html, phone UI
   live. SMOKE_CDP=http://localhost:9223 SMOKE_PORT=7698. */
const { chromium } = require("playwright-core");

const CDP = process.env.SMOKE_CDP || "http://localhost:9223";
const PORT = Number(process.env.SMOKE_PORT || 7698);
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages()[0];
  try {
    await page.evaluate(async (port) => {
      const s = await window.piwright.getSettings();
      await window.piwright.setSettings({
        ...s,
        notifications: { ...s.notifications, remote: { ...s.notifications.remote, enabled: true, port } },
      });
    }, PORT);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".panel-foot button.icon", { timeout: 30000 });

    let status = null;
    for (let i = 0; i < 30; i++) {
      status = await page.evaluate(() => window.piwright.remoteStatus());
      if (status.running) break;
      await page.waitForTimeout(1000);
    }
    if (!status || !status.running) throw new Error("remote did not start: " + JSON.stringify(status));
    const pin = String(status.pin).replace(/\s/g, "");
    console.log("remote up on port", status.port);

    const phone = await chromium.launch({ executablePath: CHROME });
    const failures = [];
    try {
      const ctx = await phone.newContext({ viewport: { width: 390, height: 844 } });
      const downloads = [];
      ctx.on("page", (p) => p.on("download", (d) => downloads.push(d.suggestedFilename())));
      const mobile = await ctx.newPage();
      await mobile.goto(`http://127.0.0.1:${PORT}/login`, { waitUntil: "load" });
      await mobile.fill("input[name=pin]", pin);
      await Promise.all([
        mobile.waitForNavigation({ waitUntil: "load", timeout: 15000 }),
        mobile.click("button[type=submit]"),
      ]);
      await mobile.waitForSelector("#send", { timeout: 15000 });
      const state = await mobile.evaluate(() => ({
        url: location.pathname,
        contentType: document.contentType,
        send: document.getElementById("send").textContent.trim(),
        input: document.getElementById("input").placeholder,
      }));
      console.log("after submit:", JSON.stringify(state));
      if (state.url !== "/") failures.push("url=" + state.url);
      if (state.contentType !== "text/html") failures.push("contentType=" + state.contentType);
      if (!state.send) failures.push("phone UI did not render");
      if (downloads.length > 0) failures.push("downloads: " + downloads.join(", "));
    } finally {
      await phone.close();
    }

    console.log(failures.length === 0 ? "SMOKE OK" : "SMOKE FAIL: " + failures.join("; "));
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    try {
      await page.evaluate(async () => {
        const s = await window.piwright.getSettings();
        await window.piwright.setSettings({
          ...s,
          notifications: { ...s.notifications, remote: { ...s.notifications.remote, enabled: false } },
        });
      });
    } catch {
      // окно уже закрыто
    }
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
