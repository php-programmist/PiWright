; Override of electron-builder CHECK_APP_RUNNING (allowOnlyOneInstallerInstance.nsh):
; the background daemon is the same PiWright.exe running in node mode
; (cmdline contains out\daemon\index.js) and trips the default "app is running"
; dialog even when the app itself is closed. Kill daemon processes silently,
; then run the stock check for the real app windows.
; When customCheckAppRunning is defined the template skips its own
; getProcessInfo.nsh include and "Var pid" - both needed by _CHECK_APP_RUNNING.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  ${if} $IsPowerShellAvailable == 0
    nsExec::Exec `"$PowerShellPath" -NoProfile -NonInteractive -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.CommandLine -like '*out\daemon\index.js*'} | % { Stop-Process -Id $$_.ProcessId -Force }"`
    Pop $0
    Sleep 500
  ${endIf}
  !insertmacro _CHECK_APP_RUNNING
!macroend
