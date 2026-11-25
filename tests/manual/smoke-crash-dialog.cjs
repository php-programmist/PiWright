/* Manual smoke: renderer-crash recovery dialog (main process).
   Launches its own non-smoke electron instance (own port + user-data-dir), crashes the
   renderer via CDP Page.crash, expects the native recovery dialog (found via Win32
   FindWindow — Electron TaskDialogs are invisible to UIA and have no child controls),
   screenshots it, clicks "Restart without sandbox" via keyboard (AppActivate + RIGHT +
   ENTER; arrow keys navigate owner-drawn TaskDialog buttons), then verifies:
   sandbox-override.json written, crash log written, app relaunched with the same CLI
   args and --no-sandbox active in renderer processes. */
const { spawn, execFileSync } = require("child_process");
const { mkdtempSync, readFileSync, existsSync, rmSync, appendFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright-core");

const REPO = join(__dirname, "..", "..");
const PORT = 9225;
const CDP = `http://localhost:${PORT}`;
const userData = mkdtempSync(join(tmpdir(), "piwright-crash-smoke-"));
const LOG = join(tmpdir(), "piwright-crash-smoke.log");

const results = [];
const log = (line) => { const stamp = new Date().toISOString().slice(11, 19); appendFileSync(LOG, `[${stamp}] ${line}\n`, "utf8"); console.log(line); };
const check = (name, ok, extra) => { results.push({ name, ok }); log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); };

function psFile(name) {
  return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(__dirname, name)], { encoding: "utf8", timeout: 30000 }).trim();
}

function cdpAlive() {
  return new Promise((resolve) => {
    const req = http.get(`${CDP}/json/version`, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mainPid = () => Number(psFile("main-pid.ps1"));
const rendererNoSandboxPid = () => Number(psFile("renderer-nosandbox.ps1"));

const WATCHDOG = setTimeout(() => {
  log("WATCHDOG: 150s elapsed");
  try { execFileSync("taskkill", ["/FI", "IMAGENAME eq electron.exe", "/FI", `WINDOWTITLE eq PiWright*`], { stdio: "ignore", timeout: 15000 }); } catch { /* best effort */ }
  process.exit(2);
}, 150000);

(async () => {
  let browser = null;
  let proc = null;
  try {
    rmSync(LOG, { force: true });
    log("launching electron, userData=" + userData);
    const electronPath = require("electron");
    proc = spawn(electronPath, [REPO, `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { cwd: REPO, stdio: "ignore" });

    const deadline = Date.now() + 60000;
    while (!(await cdpAlive())) { if (Date.now() > deadline) throw new Error("CDP never came up"); await sleep(500); }
    log("CDP up");

    browser = await chromium.connectOverCDP(CDP);
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith("devtools://"));
    if (!page) throw new Error("no app page");
    await page.waitForLoadState("domcontentloaded");
    await sleep(1500);
    const oldPid = mainPid();
    log("crashing renderer");
    const session = await page.context().newCDPSession(page);
    // Page.crash kills the renderer mid-command — the CDP response never arrives, so
    // awaiting it hangs forever. Fire and forget.
    void session.send("Page.crash").catch(() => {});

    let hwnd = "";
    const dlgDeadline = Date.now() + 20000;
    while (Date.now() < dlgDeadline && !hwnd) {
      hwnd = psFile("find-dialog.ps1");
      if (!hwnd) await sleep(700);
    }
    check("recovery dialog appeared", hwnd !== "", `hwnd=${hwnd}`);
    if (hwnd) {
      log(psFile("shot-dialog.ps1"));
      log("clicking Restart without sandbox via keyboard");
      log(psFile("keyboard-click.ps1"));
    }

    let relaunched = false;
    let rendererPid = 0;
    const relDeadline = Date.now() + 40000;
    while (Date.now() < relDeadline) {
      const newPid = mainPid();
      if (newPid !== 0 && newPid !== oldPid) {
        rendererPid = rendererNoSandboxPid();
        if (rendererPid !== 0 && (await cdpAlive())) { relaunched = true; break; }
      }
      await sleep(1000);
    }
    check("app relaunched with same args + renderer has --no-sandbox", relaunched, `oldPid=${oldPid} rendererPid=${rendererPid}`);

    const overridePath = join(userData, "sandbox-override.json");
    const override = existsSync(overridePath) ? JSON.parse(readFileSync(overridePath, "utf8")) : null;
    check("sandbox-override.json written", override?.noSandbox === true && typeof override.reason === "string" && override.reason.includes("crashed"), JSON.stringify(override));

    const logText = existsSync(join(userData, "crash-log.txt")) ? readFileSync(join(userData, "crash-log.txt"), "utf8") : "";
    check("crash log written", logText.includes("crashed") && logText.includes("v0.4.1"), (logText.trim().split("\n")[0] ?? ""));

    const newPid = mainPid();
    if (newPid !== 0) { execFileSync("taskkill", ["/PID", String(newPid), "/T", "/F"], { stdio: "ignore", timeout: 15000 }); log("killed relaunched instance " + newPid); }
    if (proc && proc.pid) { try { proc.kill(); } catch { /* already gone */ } }

    const failed = results.filter((r) => !r.ok);
    log(failed.length === 0 ? "SMOKE OK" : `SMOKE FAILED: ${failed.length}`);
    clearTimeout(WATCHDOG);
    process.exit(failed.length === 0 ? 0 : 1);
  } catch (err) {
    log("SMOKE ERROR: " + err.message);
    clearTimeout(WATCHDOG);
    process.exit(1);
  } finally {
    if (browser) await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
    rmSync(userData, { recursive: true, force: true });
  }
})();
