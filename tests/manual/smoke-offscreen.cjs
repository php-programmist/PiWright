/* Manual smoke: --smoke launch mode. Window must sit outside every monitor, must not own the
   OS foreground window, and must still paint (screenshot non-blank, rAF alive).
   Run against an instance started with:
     npx electron . --smoke --remote-debugging-port=9223 --user-data-dir=%TEMP%\piwright-smoke-userdata
   document.hasFocus() is reported only: Chromium keeps a ShowWindow(SW_SHOWNOACTIVATE) window
   internally focused, so OS foreground (user32 GetForegroundWindow) is the real check. */
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright-core");

const CDP = process.env.SMOKE_CDP || "http://localhost:9223";
const PORT = new URL(CDP).port || "9222";

const PS = `
$s = @'
using System;using System.Text;using System.Runtime.InteropServices;
public class Fg{
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 public static long Pid(){uint p;GetWindowThreadProcessId(GetForegroundWindow(),out p);return p;}
 public static string Title(){var b=new StringBuilder(256);GetWindowText(GetForegroundWindow(),b,256);return b.ToString();}
}
'@
Add-Type -TypeDefinition $s | Out-Null
$main = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*--smoke*' -and $_.CommandLine -like "*--remote-debugging-port=${PORT}*" -and $_.CommandLine -notlike '*--type=*' } |
  Select-Object -First 1
[pscustomobject]@{ smokePid = $(if ($main) { $main.ProcessId } else { 0 }); fgPid = [Fg]::Pid(); fgTitle = [Fg]::Title() } | ConvertTo-Json -Compress
`;

(async () => {
  const win = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS], { encoding: "utf8" }).trim());

  const browser = await chromium.connectOverCDP(CDP);
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page = pages.find((p) => !p.url().startsWith("devtools://"));
  if (!page) { console.error("no app page among", pages.map((p) => p.url())); process.exit(1); }
  await page.waitForLoadState("domcontentloaded");

  const rafMs = await page.evaluate(
    () => new Promise((r) => { const t = performance.now(); requestAnimationFrame(() => r(performance.now() - t)); })
  );
  const geo = await page.evaluate(() => ({
    screenX: window.screenX,
    screenY: window.screenY,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    hasFocus: document.hasFocus(),
    visibility: document.visibilityState,
    rootChildren: document.getElementById("root")?.childElementCount ?? 0,
    bodyChars: document.body.innerText.trim().length
  }));
  const png = await page.screenshot({ path: path.join(__dirname, "out-offscreen.png") });

  const checks = {
    instanceFound: win.smokePid !== 0,
    foregroundNotStolen: win.fgPid !== win.smokePid,
    offscreen: geo.screenX < -1000 && geo.screenY < -1000,
    visibleForCompositor: geo.visibility === "visible",
    rafAlive: rafMs >= 0 && rafMs < 2000,
    rendered: geo.rootChildren > 0 && geo.bodyChars > 0,
    screenshotPainted: png.length > 20000
  };
  console.log(JSON.stringify({ win, geo, rafMs, pngBytes: png.length, checks }, null, 2));
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
