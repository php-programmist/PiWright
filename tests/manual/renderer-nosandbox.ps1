$r = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*--type=renderer*' -and $_.CommandLine -like '*--no-sandbox*' } |
  Select-Object -First 1
if ($r) { $r.ProcessId } else { '0' }
