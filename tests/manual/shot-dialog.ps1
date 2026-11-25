Add-Type -AssemblyName System.Drawing | Out-Null
Add-Type @'
using System;using System.Runtime.InteropServices;
public class SD {
  [DllImport("user32.dll",CharSet=CharSet.Auto)] public static extern IntPtr FindWindow(string cls, string title);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
'@
$h = [SD]::FindWindow('#32770', 'PiWright UI crash')
if ($h -eq [IntPtr]::Zero) { 'no dialog'; exit 1 }
$r = New-Object SD+RECT
[SD]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.R - $r.L; $ht = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$out = Join-Path $PSScriptRoot 'out-crash-dialog.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"saved $out"
