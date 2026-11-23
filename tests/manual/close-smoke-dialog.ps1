param([string]$Match = 'piwright-smoke')
$code = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumThreadWindows(uint tid, EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
}
'@
Add-Type -TypeDefinition $code
$script:log = New-Object System.Collections.ArrayList

$procs = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like "*$Match*" }
foreach ($pr in $procs) {
  $p = Get-Process -Id $pr.ProcessId -ErrorAction SilentlyContinue
  if (-not $p) { continue }
  foreach ($t in $p.Threads) {
    $cb = [W+EnumProc] { param($h, $l)
      $cn = New-Object System.Text.StringBuilder 256; [void][W]::GetClassName($h, $cn, 256)
      $tt = New-Object System.Text.StringBuilder 256; [void][W]::GetWindowText($h, $tt, 256)
      $cls = $cn.ToString(); $title = $tt.ToString()
      if ($cls -eq '#32770') {
        $cancel = [W]::GetDlgItem($h, 2)
        if ($cancel -ne [IntPtr]::Zero) {
          [void][W]::PostMessage($cancel, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
          [void]$script:log.Add("BM_CLICK(IDCANCEL) -> $h")
        } else {
          [void][W]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
          [void]$script:log.Add("WM_CLOSE -> $h")
        }
      } elseif ($cls -eq 'Chrome_WidgetWin_1' -and [W]::IsWindowVisible($h) -and [W]::GetWindow($h, 4) -ne [IntPtr]::Zero) {
        # GW_OWNER = 4: modal save dialog is owned by the main window, the main window itself is not
        [void][W]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
        [void]$script:log.Add("WM_CLOSE owned Chrome_WidgetWin_1 -> $h")
      }
      $true
    }
    [void][W]::EnumThreadWindows([uint32]$t.Id, $cb, [IntPtr]::Zero)
  }
}
if ($script:log.Count -eq 0) { Write-Output 'no dialog window' } else { $script:log }
