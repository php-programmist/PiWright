/* Manual smoke: kanban in remote (kanban c-fc45802e).
   1) Header menu «⋮» shows New session + Kanban; Kanban opens the boards list with projects.
   2) A board opens as a local tab with the tree (columns → cards); a card is created from «+».
   3) Card tab: description edit, column selector move, comment add.
   4) Run in new session: a new shared session appears on the PC (closed immediately).
   5) Column loop (exact count) starts a looped session (stopped immediately).
   6) Long-press on a board tab → Close removes the tab.
   SMOKE_CDP=http://localhost:9223 SMOKE_PORT=7698 */
const http = require("http");
const { chromium } = require("playwright-core");

const CDP = process.env.SMOKE_CDP || "http://localhost:9223";
const PORT = Number(process.env.SMOKE_PORT || 7698);
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROJECT = { kind: "native", dir: "D:\\Projects\\piwright" };
const BOARD_NAME = "smoke-rk-" + Date.now();
const CARD_TITLE = "smoke rk card " + Date.now();
const DESC_TEXT = "smoke description " + Date.now();
const COMMENT_TEXT = "smoke comment " + Date.now();

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
  let tempHosts = [];
  let boardId = null;
  const results = {};
  try {
    await page.evaluate(async (port) => {
      const s = await window.piwright.getSettings();
      await window.piwright.setSettings({
        ...s,
        loopsEnabled: true,
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

    // Сессия с моделями + шаринг: проект попадает в статусы, телефону есть куда создавать сессии.
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
    await page.evaluate((hostId) => window.piwright.shareSession(hostId, true), hostA);

    // Временная доска: реальные доски не трогаем.
    const board = await page.evaluate(async (name) => {
      return window.piwright.kanbanBoardCreate({ kind: "native", dir: "D:\\Projects\\piwright" }, name);
    }, BOARD_NAME);
    if (!board.ok || !board.board) throw new Error("temp board create failed: " + board.error);
    boardId = board.board.id;
    console.log("temp board", boardId);

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

    // 1) Меню «⋮»: Новая сессия + Канбан; старой кнопки «+» нет.
    results.menuButton = await ppage.evaluate(() => {
      const btn = document.getElementById("menuButton");
      return btn !== null && btn.textContent.includes("⋮");
    });
    await ppage.click("#menuButton");
    await ppage.waitForFunction(() => !document.getElementById("mainMenu").hidden, { timeout: 5000 });
    results.menuItems = await ppage.evaluate(() => {
      const items = [...document.querySelectorAll("#mainMenu .menu-item")].map((n) => n.textContent.trim());
      return items;
    });
    await ppage.click("#menuKanban");

    // 2) Список досок: проект + временная доска.
    await ppage.waitForFunction(
      (name) => [...document.querySelectorAll(".modal .menu-item")].some((n) => n.textContent.includes(name)),
      BOARD_NAME,
      { timeout: 15000 }
    );
    results.boardList = await ppage.evaluate(
      (name) =>
        [...document.querySelectorAll(".modal .menu-item")].some((n) => n.textContent.includes(name)) &&
        [...document.querySelectorAll(".modal .kb-project")].some((n) => n.textContent.trim() === "piwright"),
      BOARD_NAME
    );
    await ppage.evaluate((name) => {
      const row = [...document.querySelectorAll(".modal .menu-item")].find((n) => n.textContent.includes(name));
      row.click();
    }, BOARD_NAME);

    // 3) Вкладка доски: дерево колонок, лента скрыта.
    await ppage.waitForFunction(() => document.querySelectorAll("#tabs .tab.local").length > 0, { timeout: 10000 });
    await ppage.waitForFunction(
      (bid) => {
        const view = document.getElementById("kanbanMain");
        return !view.hidden && view.textContent.includes("Backlog") && view.textContent.includes("Done");
      },
      boardId,
      { timeout: 15000 }
    );
    results.boardTree = await ppage.evaluate(() => {
      const view = document.getElementById("kanbanMain");
      return {
        streamHidden: document.getElementById("stream").hidden,
        footerHidden: document.querySelector("footer").hidden,
        columns: view.querySelectorAll(".kb-col").length,
        loopMenu: view.querySelectorAll(".kb-col-head .kb-col-btn:nth-of-type(2)").length > 0,
      };
    });

    // 4) Создание карточки из «+» первой колонки.
    await ppage.evaluate(() => document.querySelector(".kb-col-head .kb-col-btn").click());
    await ppage.waitForFunction(() => document.querySelector(".modal input") !== null, { timeout: 5000 });
    await ppage.fill(".modal input", CARD_TITLE);
    await ppage.evaluate(() => {
      const create = [...document.querySelectorAll(".modal .actions button")].find((b) => !b.className.includes("ghost"));
      create.click();
    });
    await ppage.waitForFunction(
      (title) => [...document.querySelectorAll(".kb-card .kb-card-title")].some((n) => n.textContent === title),
      CARD_TITLE,
      { timeout: 15000 }
    );
    results.cardCreated = true;

    // 5) Вкладка карточки: правка описания.
    await ppage.evaluate((title) => {
      const row = [...document.querySelectorAll(".kb-card")].find((n) => n.textContent.includes(title));
      row.click();
    }, CARD_TITLE);
    await ppage.waitForFunction(
      (title) => document.querySelector("#kanbanMain .kb-card-big")?.textContent === title,
      CARD_TITLE,
      { timeout: 10000 }
    );
    await ppage.evaluate(() => {
      const edit = [...document.querySelectorAll("#kanbanMain .kb-desc-head button")].find((b) => b.textContent.includes("✎"));
      edit.click();
    });
    await ppage.waitForFunction(() => document.querySelector("#kanbanMain .kb-edit textarea") !== null, { timeout: 5000 });
    await ppage.fill("#kanbanMain .kb-edit textarea", DESC_TEXT);
    await ppage.evaluate(() => {
      const save = [...document.querySelectorAll("#kanbanMain .kb-edit .actions button")].find((b) => !b.className.includes("ghost"));
      save.click();
    });
    await ppage.waitForFunction(
      (text) => document.querySelector("#kanbanMain .kb-desc-text")?.textContent.includes(text),
      DESC_TEXT,
      { timeout: 15000 }
    );
    results.descriptionEdited = true;

    // 6) Комментарий.
    await ppage.fill("#kanbanMain .kb-add-comment textarea", COMMENT_TEXT);
    await ppage.evaluate(() => {
      const send = [...document.querySelectorAll("#kanbanMain .kb-add-comment button")].find((b) => b.textContent !== "");
      send.click();
    });
    await ppage.waitForFunction(
      (text) => [...document.querySelectorAll("#kanbanMain .kb-comment-text")].some((n) => n.textContent.includes(text)),
      COMMENT_TEXT,
      { timeout: 15000 }
    );
    results.commentAdded = true;

    // 7) Перемещение селектором колонок.
    const targetColumn = await ppage.evaluate(() => {
      const select = document.querySelector("#kanbanMain .kb-col-select");
      return select.options[select.options.length - 1].value;
    });
    await ppage.selectOption("#kanbanMain .kb-col-select", targetColumn);
    const movedOnPc = await waitUntil(
      async () => {
        const check = await page.evaluate(
          async (args) => {
            const board = await window.piwright.kanbanBoardGet({ kind: "native", dir: "D:\\Projects\\piwright" }, args.boardId);
            const card = board.board?.cards.find((c) => c.title.startsWith("smoke rk card"));
            return card && card.columnId === args.targetColumn;
          },
          { boardId, targetColumn }
        );
        return check || null;
      },
      15000,
      "card move reaches the PC board"
    );
    results.cardMoved = movedOnPc === true;

    // 8) Выполнить в новой сессии: на ПК появляется сессия (сразу закрываем — реальный ход не нужен).
    const beforeRun = await page.evaluate(async () => (await window.piwright.listSessions()).active.map((s) => s.hostId));
    await ppage.evaluate(() => {
      const run = document.querySelector("#kanbanMain .kb-run");
      run.click();
    });
    const runHost = await waitUntil(
      async () => {
        const list = await page.evaluate(async () => (await window.piwright.listSessions()).active);
        const fresh = list.map((s) => s.hostId).find((id) => !beforeRun.includes(id));
        return fresh ?? null;
      },
      30000,
      "kanban_run session on PC"
    );
    tempHosts.push(runHost);
    results.runSession = runHost !== null;
    await ppage.waitForFunction(() => document.getElementById("stream").hidden === false, { timeout: 15000 }).catch(() => {});
    await page.evaluate((hostId) => window.piwright.closeSession(hostId), runHost);

    // 9) Петля колонки: меню «⋯» → точное количество (пустая колонка — ход без задач дешёвый).
    // reload сбрасывает локальные вкладки — доску открываем заново через меню.
    await ppage.reload({ waitUntil: "load" });
    await ppage.waitForFunction(() => document.querySelectorAll("#tabs .tab").length > 0, { timeout: 20000 });
    await ppage.click("#menuButton");
    await ppage.waitForFunction(() => !document.getElementById("mainMenu").hidden, { timeout: 5000 });
    await ppage.click("#menuKanban");
    await ppage.waitForFunction(
      (name) => [...document.querySelectorAll(".modal .menu-item")].some((n) => n.textContent.includes(name)),
      BOARD_NAME,
      { timeout: 15000 }
    );
    await ppage.evaluate((name) => {
      const row = [...document.querySelectorAll(".modal .menu-item")].find((n) => n.textContent.includes(name));
      row.click();
    }, BOARD_NAME);
    await ppage.waitForFunction(
      (bid) => {
        const view = document.getElementById("kanbanMain");
        return !view.hidden && view.querySelectorAll(".kb-col").length > 0;
      },
      boardId,
      { timeout: 15000 }
    );
    results.loopMenuVisible = await ppage.evaluate(() => {
      const heads = [...document.querySelectorAll(".kb-col-head")];
      return heads.some((h) => [...h.querySelectorAll(".kb-col-btn")].some((b) => b.textContent === "⋯"));
    });
    const beforeLoop = await page.evaluate(async () => (await window.piwright.listSessions()).active.map((s) => s.hostId));
    await ppage.evaluate(() => {
      const heads = [...document.querySelectorAll(".kb-col-head")];
      const review = heads.find((h) => h.querySelector(".kb-col-name").textContent === "Review");
      const dots = [...review.querySelectorAll(".kb-col-btn")].find((b) => b.textContent === "⋯");
      dots.click();
    });
    await ppage.waitForFunction(() => document.querySelector(".modal") !== null, { timeout: 5000 });
    await ppage.evaluate(() => {
      const item = [...document.querySelectorAll(".modal .menu-item")].find((n) => n.textContent.includes("("));
      item.click();
    });
    const loopHost = await waitUntil(
      async () => {
        const list = await page.evaluate(async () => (await window.piwright.listSessions()).active);
        const fresh = list.map((s) => s.hostId).find((id) => !beforeLoop.includes(id));
        return fresh ?? null;
      },
      30000,
      "kanban_loop session on PC"
    );
    tempHosts.push(loopHost);
    const loopInfo = loopHost ? await page.evaluate((hostId) => window.piwright.loopGet(hostId), loopHost) : null;
    results.loopStarted = loopInfo !== null && loopInfo.active === true;
    await page.evaluate((hostId) => window.piwright.loopStop(hostId), loopHost);
    await page.evaluate((hostId) => window.piwright.closeSession(hostId), loopHost);

    // 10) Закрытие вкладки доски: долгое нажатие → «Закрыть».
    await ppage.evaluate((name) => {
      const tab = [...document.querySelectorAll("#tabs .tab.local")].find((t) => t.textContent.includes(name));
      const rect = tab.getBoundingClientRect();
      tab.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: rect.x + 5, clientY: rect.y + 5, pointerId: 1, isPrimary: true })
      );
    }, BOARD_NAME);
    await ppage.waitForFunction(() => document.querySelector(".modal") !== null, { timeout: 5000 });
    await ppage.evaluate(() => {
      document.querySelector(".modal .menu-item.danger").click();
    });
    await ppage.waitForFunction(() => document.querySelectorAll("#tabs .tab.local").length === 0, { timeout: 5000 });
    results.tabClosed = true;

    const ok =
      results.menuButton &&
      results.menuItems.length === 2 &&
      results.boardList &&
      results.boardTree.streamHidden &&
      results.boardTree.footerHidden &&
      results.boardTree.columns === 5 &&
      results.cardCreated &&
      results.descriptionEdited &&
      results.commentAdded &&
      results.cardMoved &&
      results.runSession &&
      results.loopMenuVisible &&
      results.loopStarted &&
      results.tabClosed;
    console.log(JSON.stringify(results, null, 2));
    console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    try {
      for (const hostId of tempHosts) await page.evaluate((id) => window.piwright.closeSession(id), hostId);
    } catch {}
    try {
      if (boardId) {
        await page.evaluate(async (id) => {
          await window.piwright.kanbanBoardDelete({ kind: "native", dir: "D:\\Projects\\piwright" }, id);
        }, boardId);
      }
    } catch {}
    try {
      if (hostA) await page.evaluate((hostId) => window.piwright.shareSession(hostId, false), hostA);
    } catch {}
    try {
      await page.evaluate(async () => {
        const s = await window.piwright.getSettings();
        await window.piwright.setSettings({
          ...s,
          loopsEnabled: false,
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
