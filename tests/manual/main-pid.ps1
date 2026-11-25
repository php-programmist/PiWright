$port = if ($env:PIWRIGHT_SMOKE_PORT) { $env:PIWRIGHT_SMOKE_PORT } else { '9225' }
$m = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like "*--remote-debugging-port=$port*" -and $_.CommandLine -notlike '*--type=*' } |
  Select-Object -First 1
if ($m) { $m.ProcessId } else { '0' }
