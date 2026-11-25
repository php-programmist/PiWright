$ws = New-Object -ComObject WScript.Shell
$ok = $ws.AppActivate('PiWright UI crash')
if (-not $ok) { 'activate failed'; exit 1 }
Start-Sleep -Milliseconds 400
$ws.SendKeys('{RIGHT}')
Start-Sleep -Milliseconds 300
$ws.SendKeys('{ENTER}')
'clicked'
