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

# Ctrl+OemComma — акселератор «Настройки» (работает и в русской раскладке: Ctrl+б)
[MenuFocus]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[MenuFocus]::keybd_event(0xBC, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[MenuFocus]::keybd_event(0xBC, 0, 2, [UIntPtr]::Zero)
[MenuFocus]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 300
'sent'
