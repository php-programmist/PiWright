Add-Type @'
using System;using System.Runtime.InteropServices;
public class FD { [DllImport("user32.dll",CharSet=CharSet.Auto)] public static extern IntPtr FindWindow(string cls, string title); }
'@
$dlg = [FD]::FindWindow('#32770', 'PiWright UI crash')
if ($dlg -ne [IntPtr]::Zero) { $dlg.ToInt64() } else { '' }
