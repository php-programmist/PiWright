/* Manual smoke: remote web UI follows the app language (settings.language).
   Enables remote, then for en and ru checks: login page HTML, served index lang attr,
   and the live client DOM in a separate headless Chrome (buttons, placeholders, titles,
   empty-state message). SMOKE_CDP=http://localhost:9223 SMOKE_PORT=7698. */
const http = require("http");
const { chromium } = require("playwright-core");

const CDP = process.env.SMOKE_CDP || "http://localhost:9223";
const PORT = Number(process.env.SMOKE_PORT || 7698);
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const EXPECT = {
  en: {
    loginTitle: "<title>PiWright remote — sign in</title>",
    loginHint: "Enter the PIN from PiWright settings",
    loginSubmit: ">Sign in</button>",
    loginError: "Wrong PIN or too many attempts.",
    empty: "No remote sessions. Enable the toggle in the tab header in the IDE.",
    send: "Send",
    stop: "Stop",
    steer: "Steer",
    inputPh: "Message…",
    loopExitPh:
      "Loop exit condition (optional): the loop stops when the agent calls loop_stop; empty — until the iteration limit",
    attachTitle: "Model does not accept images",
    tgTitle: "Telegram notifications off",
    hideToolsTitle: "Hide tool blocks",
    readModeTitle: "Read mode",
    newSessionTitle: "New session",
    dotTitle: "PC link",
    tabsAria: "Sessions",
    cancel: "Cancel",
    create: "Create",
    h2: "New session",
    loopSpan: "Loop",
    loopMaxTitle: "Loop iterations left",
  },
  ru: {
    loginTitle: "<title>PiWright remote — вход</title>",
    loginHint: "Введи PIN из настроек PiWright",
    loginSubmit: ">Войти</button>",
    loginError: "Неверный PIN или слишком много попыток.",
    empty: "Нет сессий на remote. Включи тоггл в шапке вкладки в IDE.",
    send: "Отправить",
    stop: "Стоп",
    steer: "Подсказать",
    inputPh: "Сообщение…",
    loopExitPh:
      "Условие выхода из петли (необязательно): петля остановится, когда агент вызовет loop_stop; пустое — до лимита итераций",
    attachTitle: "Модель не принимает картинки",
    tgTitle: "Уведомления в Telegram выключены",
    hideToolsTitle: "Скрыть блоки инструментов",
    readModeTitle: "Режим чтения",
    newSessionTitle: "Новая сессия",
    dotTitle: "связь с ПК",
    tabsAria: "Сессии",
    cancel: "Отмена",
    create: "Создать",
    h2: "Новая сессия",
    loopSpan: "Петля",
    loopMaxTitle: "Сколько итераций ещё осталось",
  },
};

function get(pathname, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, path: pathname, method: "GET", headers: cookie ? { Cookie: cookie } : {} },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

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

async function setLanguage(page, lang) {
  await page.evaluate(async (l) => {
    const s = await window.piwright.getSettings();
    await window.piwright.setSettings({ ...s, language: l, notifications: { ...s.notifications } });
  }, lang);
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".panel-foot button.icon", { timeout: 30000 });
}

async function clientChecks(cookieValue, lang) {
  const exp = EXPECT[lang];
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addCookies([{ name: "pi_remote", value: cookieValue.replace(/^pi_remote=/, ""), url: `http://127.0.0.1:${PORT}` }]);
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    await page.waitForFunction(() => {
      const info = document.querySelector("#stream .info, #stream .error");
      return info !== null;
    }, { timeout: 15000 });
    const client = await page.evaluate(() => {
      const q = (id) => document.getElementById(id);
      const info = document.querySelector("#stream .info, #stream .error");
      const texts = {
        lang: document.documentElement.lang,
        send: q("send").textContent.trim(),
        stop: q("stop").textContent.trim(),
        steer: q("steer").textContent.trim(),
        inputPh: q("input").placeholder,
        loopExitPh: q("loopExit").placeholder,
        attachTitle: q("attach").title,
        tgTitle: q("tgNotify").title,
        hideToolsTitle: q("hideTools").title,
        readModeTitle: q("readMode").title,
        newSessionTitle: q("newSession").title,
        dotTitle: q("dot").title,
        tabsAria: q("tabs").getAttribute("aria-label"),
        cancel: q("createCancel").textContent.trim(),
        create: q("createSubmit").textContent.trim(),
        h2: document.querySelector("#createForm h2").textContent.trim(),
        loopSpan: document.querySelector(".loop-toggle span").textContent.trim(),
        loopMaxTitle: q("loopMax").title,
        info: info ? info.textContent.trim() : null,
      };
      const cyr = /[\u0400-\u04FF]/;
      const visible = [
        texts.send, texts.stop, texts.steer, texts.inputPh, texts.attachTitle, texts.tgTitle,
        texts.hideToolsTitle, texts.readModeTitle, texts.newSessionTitle, texts.dotTitle,
        texts.tabsAria, texts.cancel, texts.create, texts.h2, texts.loopSpan, texts.loopMaxTitle,
      ];
      return { ...texts, hasCyrillic: visible.some((v) => cyr.test(v)) };
    });
    return client;
  } finally {
    await browser.close();
  }
}

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages()[0];
  let cookieValue = null;
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
    console.log("remote up on port", status.port);

    const pin = String(status.pin).replace(/\s/g, "");
    const login = await postLogin(pin);
    cookieValue = (login.setCookie || []).map((c) => c.split(";")[0]).find((c) => c.startsWith("pi_remote="));
    if (!cookieValue) throw new Error("no session cookie, status " + login.status);
    const cookie = cookieValue;

    const failures = [];
    for (const lang of ["en", "ru"]) {
      await setLanguage(page, lang);
      const exp = EXPECT[lang];
      const loginHtml = (await get("/login?e=1")).body;
      const indexHtml = (await get("/", cookie)).body;
      const client = await clientChecks(cookieValue, lang);
      const checks = {
        loginTitle: loginHtml.includes(exp.loginTitle),
        loginHint: loginHtml.includes(exp.loginHint),
        loginSubmit: loginHtml.includes(exp.loginSubmit),
        loginError: loginHtml.includes(exp.loginError),
        indexLang: indexHtml.includes(`<html lang="${lang}">`),
        clientLang: client.lang === lang,
        send: client.send === exp.send,
        stop: client.stop === exp.stop,
        steer: client.steer === exp.steer,
        inputPh: client.inputPh === exp.inputPh,
        loopExitPh: client.loopExitPh === exp.loopExitPh,
        attachTitle: client.attachTitle === exp.attachTitle,
        tgTitle: client.tgTitle === exp.tgTitle,
        hideToolsTitle: client.hideToolsTitle === exp.hideToolsTitle,
        readModeTitle: client.readModeTitle === exp.readModeTitle,
        newSessionTitle: client.newSessionTitle === exp.newSessionTitle,
        dotTitle: client.dotTitle === exp.dotTitle,
        tabsAria: client.tabsAria === exp.tabsAria,
        cancel: client.cancel === exp.cancel,
        create: client.create === exp.create,
        h2: client.h2 === exp.h2,
        loopSpan: client.loopSpan === exp.loopSpan,
        loopMaxTitle: client.loopMaxTitle === exp.loopMaxTitle,
        emptyState: client.info === exp.empty,
        noCyrillicInEn: lang !== "en" || client.hasCyrillic === false,
      };
      const bad = Object.entries(checks).filter(([, v]) => !v);
      console.log(`[${lang}]`, bad.length === 0 ? "all checks pass" : "FAILED: " + bad.map(([k]) => k).join(", "));
      if (bad.length > 0) {
        failures.push({ lang, bad: bad.map(([k]) => k), client });
        console.log("client state:", JSON.stringify(client, null, 2));
      }
    }

    console.log(failures.length === 0 ? "SMOKE OK" : "SMOKE FAIL");
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    try {
      await page.evaluate(async () => {
        const s = await window.piwright.getSettings();
        await window.piwright.setSettings({
          ...s,
          language: "en",
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
