/* Manual smoke: remote create-session flow (kanban c-9467a9de).
   1) Create dialog shows models + thinking levels (catalog from a fresh app).
   2) A session created from the phone attaches with a model label.
   3) A prompt sent to that phone-created session appears in the feed.
   SMOKE_CDP=http://localhost:9223 SMOKE_PORT=7698 */
const http = require("http");
const { chromium } = require("playwright-core");

const CDP = process.env.SMOKE_CDP || "http://localhost:9223";
const PORT = Number(process.env.SMOKE_PORT || 7698);
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROJECT = { kind: "native", dir: "D:\\Projects\\piwright" };
const NAME = "smoke remote create " + Date.now();
const PROMPT = "smoke prompt " + Date.now();

function postLogin(pin) {
  return new Promise((resolve, reject) => {
    const body = `pin=${encodeURIComponent(pin)}`;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: "/login",
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, setCookie: res.headers["set-cookie"] }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function waitUntil(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout: " + label + " — last: " + JSON.stringify(last));
}

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages()[0];
  let phone = null;
  let hostA = null;
  let hostB = null;
  try {
    await page.evaluate(async (port) => {
      const s = await window.piwright.getSettings();
      await window.piwright.setSettings({
        ...s,
        notifications: { ...s.notifications, remote: { ...s.notifications.remote, enabled: true, port } },
      });
    }, PORT);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => typeof window.piwright?.remoteStatus === "function", { timeout: 30000 });

    const status = await waitUntil(
      async () => {
        const s = await page.evaluate(() => window.piwright.remoteStatus());
        return s.running ? s : null;
      },
      30000,
      "remote start"
    );
    console.log("remote up on port", status.port);
    const pin = String(status.pin).replace(/\s/g, "");

    // Сессия на ПК + шаринг: иначе телефону некуда создавать вкладку.
    hostA = await page.evaluate(async (project) => {
      const list = await window.piwright.listSessions();
      if (list.active.length > 0) return list.active[0].hostId;
      const created = await window.piwright.newSession(project);
      return created.hostId;
    }, PROJECT);
    await waitUntil(
      async () => {
        const list = await page.evaluate(() => window.piwright.listSessions());
        const active = list.active.find((s) => s.hostId === hostA);
        return active && active.models.length > 0 ? active : null;
      },
      90000,
      "handshake with models"
    );
    console.log("host session has models");
    await page.evaluate((hostId) => window.piwright.shareSession(hostId, true), hostA);

    // Телефон.
    const login = await postLogin(pin);
    const cookie = (login.setCookie || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pi_remote="));
    if (!cookie) throw new Error("no session cookie, status " + login.status);
    phone = await chromium.launch({ executablePath: CHROME });
    const ctx = await phone.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addCookies([{ name: "pi_remote", value: cookie.replace(/^pi_remote=/, ""), url: `http://127.0.0.1:${PORT}` }]);
    const ppage = await ctx.newPage();
    await ppage.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    await ppage.waitForFunction(() => document.querySelectorAll("#tabs .tab").length > 0, { timeout: 20000 });

    // 1) Каталог в форме создания: модели и thinking не пустые.
    await ppage.click("#newSession");
    await ppage.waitForFunction(() => document.getElementById("createModel").options.length > 1, { timeout: 30000 });
    const catalog = await ppage.evaluate(() => ({
      models: document.getElementById("createModel").options.length - 1,
      thinkingVisible: !document.getElementById("createThinkingRow").hidden,
      thinkingOptions: document.getElementById("createThinking").options.length - 1,
    }));
    console.log("catalog:", JSON.stringify(catalog));

    // 2) Создание с телефона: вкладка появилась, сессия attached, модель в шапке.
    const before = await page.evaluate(async () => (await window.piwright.listSessions()).active.map((s) => s.hostId));
    await ppage.fill("#createName", NAME);
    await ppage.click("#createSubmit");
    await ppage.waitForFunction(
      (name) => [...document.querySelectorAll("#tabs .tab .label")].some((t) => t.textContent === name),
      NAME,
      { timeout: 30000 }
    );
    await ppage.waitForFunction(() => document.querySelector("#tabs .tab.active") !== null, { timeout: 30000 });
    await ppage.waitForFunction(() => document.getElementById("model").textContent.trim().length > 0, {
      timeout: 60000,
    });
    const modelLabel = await ppage.evaluate(() => document.getElementById("model").textContent.trim());
    console.log("created session model label:", modelLabel);
    hostB = await waitUntil(
      async () => {
        const list = await page.evaluate(async () => (await window.piwright.listSessions()).active);
        const fresh = list.map((s) => s.hostId).find((id) => !before.includes(id));
        return fresh ?? null;
      },
      30000,
      "new host on PC side"
    );

    // 3) Промпт в ленту: сообщение пользователя появляется.
    await ppage.fill("#input", PROMPT);
    await ppage.click("#send");
    await ppage.waitForFunction(
      (text) => [...document.querySelectorAll("#stream .msg.user")].some((n) => n.textContent.includes(text)),
      PROMPT,
      { timeout: 60000 }
    );
    console.log("prompt visible in feed");

    // Агент начал отвечать — гасим ход, чтобы смоук не оставлял живой процесс.
    await ppage.waitForFunction(() => !document.getElementById("stop").hidden, { timeout: 30000 }).catch(() => {});
    const stopVisible = await ppage.evaluate(() => !document.getElementById("stop").hidden);
    if (stopVisible) await ppage.click("#stop");

    const ok = catalog.models > 0 && modelLabel.length > 0;
    console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    try {
      if (hostB) await page.evaluate((hostId) => window.piwright.closeSession(hostId), hostB);
    } catch {}
    try {
      if (hostA) await page.evaluate((hostId) => window.piwright.shareSession(hostId, false), hostA);
    } catch {}
    try {
      await page.evaluate(async () => {
        const s = await window.piwright.getSettings();
        await window.piwright.setSettings({
          ...s,
          notifications: { ...s.notifications, remote: { ...s.notifications.remote, enabled: false } },
        });
      });
    } catch {}
    try {
      if (phone) await phone.close();
    } catch {}
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
