Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class MenuFocus {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);

  public static IntPtr Found = IntPtr.Zero;
  public static uint TargetPid;
  public static bool Cb(IntPtr h, IntPtr l) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid == TargetPid && IsWindowVisible(h)) {
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString() == "PiWright") { Found = h; return false; }
    }
    return true;
  }
  public static IntPtr FindByPid(uint pid) { TargetPid = pid; Found = IntPtr.Zero; EnumWindows(Cb, IntPtr.Zero); return Found; }
}
"@
$smokePid = [uint32]$args[0]
$h = [MenuFocus]::FindByPid($smokePid)
"handle=$h"
if ($h -eq [IntPtr]::Zero) { throw 'smoke window not found' }

$fg = [MenuFocus]::GetForegroundWindow()
$fgThread = [MenuFocus]::GetWindowThreadProcessId($fg, [ref]([uint32]0))
$myThread = [MenuFocus]::GetCurrentThreadId()
for ($i = 0; $i -lt 5; $i++) {
  [MenuFocus]::AttachThreadInput($myThread, $fgThread, $true) | Out-Null
  [MenuFocus]::SetForegroundWindow($h) | Out-Null
  [MenuFocus]::AttachThreadInput($myThread, $fgThread, $false) | Out-Null
  Start-Sleep -Milliseconds 400
  if ([MenuFocus]::GetForegroundWindow() -eq $h) { break }
  # фолбэк: свернуть/развернуть — restore активирует окно
  [MenuFocus]::ShowWindow($h, 6) | Out-Null
  Start-Sleep -Milliseconds 200
  [MenuFocus]::ShowWindow($h, 9) | Out-Null
  Start-Sleep -Milliseconds 400
  $fg = [MenuFocus]::GetForegroundWindow()
  $fgThread = [MenuFocus]::GetWindowThreadProcessId($fg, [ref]([uint32]0))
}
"fg-after=$([MenuFocus]::GetForegroundWindow())"
if ([MenuFocus]::GetForegroundWindow() -ne $h) { throw 'failed to focus smoke window' }

# Клавиши акселератора: аргументы 2+ — VK-коды (по умолчанию Ctrl+OemComma — «Настройки»;
# работает и в русской раскладке: Ctrl+б). Пример: Ctrl+Shift+S = 0x11 0x10 0x53 (Alt = 0x12).
$keys = @($args | Select-Object -Skip 1)
if ($keys.Count -eq 0) { $keys = @(0x11, 0xBC) }
[MenuFocus]::keybd_event([byte]$keys[0], 0, 0, [UIntPtr]::Zero)
for ($i = 1; $i -lt $keys.Count; $i++) {
  Start-Sleep -Milliseconds 60
  [MenuFocus]::keybd_event([byte]$keys[$i], 0, 0, [UIntPtr]::Zero)
}
Start-Sleep -Milliseconds 60
for ($i = $keys.Count - 1; $i -ge 0; $i--) {
  [MenuFocus]::keybd_event([byte]$keys[$i], 0, 2, [UIntPtr]::Zero)
}
Start-Sleep -Milliseconds 300
'sent'
