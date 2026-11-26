/* Manual smoke: Linux port of the main process, run against an instance in WSL/Linux started with:
     npx electron . --smoke --remote-debugging-port=9333 --user-data-dir=/tmp/piwright-smoke-userdata
   Settings must be seeded BEFORE launch with a native project /tmp/smoke-proj (the add-project
   path opens a native dialog that cannot be driven over CDP).
   Checks: platform=linux in renderer, posix default sounds, WSL hidden in UI (add-project
   buttons + settings), posix file browser, bash terminal profiles + pty echo, native pi session
   spawns and becomes ready (backend resolve + spawn + RPC handshake on Linux). */
const { chromium } = require("playwright-core");

const CDP = process.env.SMOKE_CDP || "http://localhost:9333";
const PROJECT = { kind: "native", dir: "/tmp/smoke-proj" };

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => !p.url().startsWith("devtools://"));
  if (!page) { console.error("FAIL: no app page among", pages.map((p) => p.url())); process.exit(1); }
  await page.waitForLoadState("domcontentloaded");

  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // 1. Platform exposed to renderer
  const platform = await page.evaluate(() => window.piwright.platform);
  check("renderer platform is linux", platform === "linux", String(platform));

  // 2. Default sounds point to bundled wav
  const sounds = await page.evaluate(async () => (await window.piwright.getSettings()).notifications.sounds);
  check(
    "default sounds are bundled wav",
    Object.values(sounds).every((p) => p.includes("notify-") && p.endsWith(".wav")),
    JSON.stringify(sounds)
  );

  // 3. Add-project buttons: Local present, WSL hidden
  await page.evaluate(() => {
    const btn = document.querySelector('button[title="Add project"]')
    btn?.click()
  })
  await page.waitForSelector(".add-project", { timeout: 5000 });
  const addButtons = await page.evaluate(() =>
    [...document.querySelectorAll(".add-project button")].map((b) => b.textContent.trim())
  );
  check("add-project shows Local", addButtons.includes("Local"), addButtons.join(","));
  check("add-project hides WSL", !addButtons.includes("WSL"), addButtons.join(","));
  await page.evaluate(() => document.querySelector(".add-project button.cancel")?.click());

  // 4. Settings overlay: Linux section, no WSL section
  await page.evaluate(() => document.querySelector('button[title="Settings"], button.collapsed-settings')?.click());
  await page.waitForSelector(".settings-section", { timeout: 5000 });
  const sectionTitles = await page.evaluate(() =>
    [...document.querySelectorAll(".settings-section h3")].map((h) => h.textContent.trim())
  );
  check("settings has Linux section", sectionTitles.includes("Linux"), sectionTitles.join(","));
  check("settings hides WSL section", !sectionTitles.includes("WSL"), sectionTitles.join(","));
  await page.keyboard.press("Escape");

  // 5. File browser over posix paths (resolveWithinRootHost + HostProjectFs posix)
  const files = await page.evaluate(async (project) => {
    const r = await window.piwright.filesList(project, "");
    return r.ok ? r.entries.map((e) => e.name).sort() : `ERROR: ${r.error}`;
  }, PROJECT);
  check(
    "file browser lists posix project",
    Array.isArray(files) && files.includes("hello.txt") && files.includes("src"),
    JSON.stringify(files)
  );

  // 6. Terminal: posix profiles, pty echo
  const profiles = await page.evaluate(async (project) => {
    const r = await window.piwright.termProfiles(project);
    return r.ok ? r.profiles.map((p) => p.id) : `ERROR: ${r.error}`;
  }, PROJECT);
  check("terminal profiles are posix shells", Array.isArray(profiles) && profiles.includes("bash") && !profiles.includes("powershell"), JSON.stringify(profiles));

  const termEcho = await page.evaluate(async (project) => {
    const created = await window.piwright.termCreate(project, "bash");
    if (!created.ok || !created.terminal) return `ERROR: ${created.error}`;
    const id = created.terminal.id;
    const marker = `SMOKE${Date.now() % 100000}`;
    const got = new Promise((resolve) => {
      const off = window.piwright.onTermData((msg) => {
        if (msg.id === id && String(msg.data).includes(marker)) { off(); resolve("seen"); }
      });
      setTimeout(() => resolve("timeout"), 10000);
      window.piwright.termInput(id, `echo ${marker}\n`);
    });
    const res = await got;
    await window.piwright.termClose(id);
    return res;
  }, PROJECT);
  check("bash pty echoes marker", termEcho === "seen", String(termEcho));

  // 7. Native pi session spawns and becomes ready (backend resolve + spawn + RPC handshake)
  await page.evaluate(() => {
    const row = [...document.querySelectorAll(".project-row")].find((r) => r.textContent.includes("smoke-proj"));
    const plus = row?.querySelector('button[title="New session"]');
    plus?.click();
  });
  await page.waitForSelector(".session-row.current", { timeout: 90000 });
  const sessionReady = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const started = Date.now();
        const poll = () => {
          const dot = document.querySelector(".session-row.current .dot");
          const cls = dot ? dot.className : "";
          if (/\bidle\b/.test(cls)) return resolve(`idle (${Date.now() - started}ms)`);
          if (/\berror\b/.test(cls)) return resolve("error");
          if (Date.now() - started > 60000) return resolve(`timeout, dot=${cls}`);
          setTimeout(poll, 500);
        };
        poll();
      })
  );
  check("pi session becomes ready", sessionReady.startsWith("idle"), sessionReady);

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? "SMOKE OK" : `SMOKE FAILED: ${failed.length}/${results.length}`);
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("SMOKE ERROR:", err);
  process.exit(1);
});
