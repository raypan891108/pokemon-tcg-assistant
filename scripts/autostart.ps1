# Run the site in the background on Windows (Task Scheduler): it starts when you log in,
# restarts if it crashes, and keeps running after the terminal is closed.
# Same commands as autostart.sh on the Mac; run it through autostart.cmd:
#
#   scripts\autostart install     build the frontend and start the service
#   scripts\autostart restart     rebuild after code changes and restart
#   scripts\autostart status      show whether it is running
#   scripts\autostart logs        follow the log
#   scripts\autostart uninstall   stop it and remove auto-start
#   scripts\autostart password    set, change or remove the login password (asked, not typed on the command line)
#
# Reinstalling keeps a password set earlier.
param([string]$Command = '')
$ErrorActionPreference = 'Stop'

$TaskName = 'Pokemon TCG Assistant'
$ProjectDir = Split-Path -Parent $PSScriptRoot
$Supervisor = Join-Path $PSScriptRoot 'windows-service.js'
$Server = Join-Path $ProjectDir 'backend\server.js'
$StateDir = Join-Path $env:LOCALAPPDATA 'pokemon-tcg-assistant'
$Log = Join-Path $StateDir 'pokemon-tcg-assistant.log'
$Config = Join-Path $StateDir 'config.json'
$Url = 'http://127.0.0.1:3001'
$Self = 'scripts\autostart'

function Test-Up {
  try {
    Invoke-WebRequest "$Url/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Get-Task {
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

# Password stored in the config file, if any
function Get-SavedPassword {
  if (Test-Path $Config) {
    $saved = Get-Content $Config -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($saved.password) { return [string]$saved.password }
  }
  return ''
}

function Save-Password([string]$Password) {
  New-Item -ItemType Directory -Force $StateDir | Out-Null
  # UTF-8 without a BOM so Node's JSON.parse reads it
  [IO.File]::WriteAllText($Config, (@{ password = $Password } | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
}

function Invoke-Build {
  Write-Host '==> 打包網頁'
  Push-Location $ProjectDir
  try {
    npm run build --workspace=frontend --silent
    if ($LASTEXITCODE -ne 0) { throw '打包失敗' }
  } finally {
    Pop-Location
  }
}

# Stopping the task doesn't always stop the processes it started, so stop them by their command line
function Stop-App {
  if (Get-Task) { Stop-ScheduledTask -TaskName $TaskName }
  foreach ($path in @($Supervisor, $Server)) {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($path) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

function Wait-Up {
  for ($i = 0; $i -lt 20; $i++) {
    if (Test-Up) {
      Write-Host "✅ 網站已在背景執行：$Url"
      return
    }
    Start-Sleep -Seconds 1
  }
  Write-Host "⚠️  網站沒有回應，請看 log：$Self logs"
  exit 1
}

function Install-App($Password = $null) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    Write-Host '找不到 node，請先安裝 Node.js'
    exit 1
  }
  if (-not (Get-Task) -and (Test-Up)) {
    Write-Host '3001 port 已經有網站在執行（可能是終端機裡的 npm start），請先按 Ctrl + C 停止它'
    exit 1
  }

  Invoke-Build

  # No password given: keep the saved one; given (even empty): use it
  if ($null -ne $Password) { Save-Password $Password }

  # conhost --headless runs node without a console window
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" `
    -Argument "--headless `"$node`" `"$Supervisor`"" -WorkingDirectory $ProjectDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

  Stop-App
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "==> 已設定登入後自動啟動$(if (Get-SavedPassword) { '（已啟用密碼登入）' })"
  Wait-Up
}

# Asked with hidden input so the password never lands in the shell history
function Read-Secret([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Set-Password {
  $p1 = Read-Secret '新的登入密碼（至少 8 個字元；直接按 Enter 表示取消密碼）'
  if (-not $p1) {
    $ok = Read-Host '確定要取消密碼？任何連得到網站的人都能使用 (y/N)'
    if ($ok -ne 'y' -and $ok -ne 'Y') {
      Write-Host '已取消，沒有變更'
      exit 0
    }
  } else {
    if ($p1.Length -lt 8) {
      Write-Host '密碼太短，至少要 8 個字元'
      exit 1
    }
    $p2 = Read-Secret '再輸入一次'
    if ($p1 -cne $p2) {
      Write-Host '兩次輸入不一樣，沒有變更'
      exit 1
    }
  }
  Install-App $p1
  if ($p1) { Write-Host '🔒 已設定密碼。所有裝置都要重新登入一次。' } else { Write-Host '🔓 已取消密碼。' }
}

function Restart-App {
  if (-not (Get-Task)) {
    Write-Host "還沒安裝自動啟動，請先執行：$Self install"
    exit 1
  }
  Invoke-Build
  Stop-App
  Start-ScheduledTask -TaskName $TaskName
  Wait-Up
}

function Show-Status {
  $task = Get-Task
  if ($task) {
    Write-Host '自動啟動：已安裝'
    Write-Host "排程狀態：$($task.State)"
    Write-Host "登入密碼：$(if (Get-SavedPassword) { '已設定' } else { '未設定' })"
  } else {
    Write-Host '自動啟動：未安裝'
  }
  if (Test-Up) { Write-Host "網站：執行中 $Url" } else { Write-Host '網站：沒有回應' }
  Write-Host "Log：$Log"
}

function Show-Logs {
  New-Item -ItemType Directory -Force $StateDir | Out-Null
  if (-not (Test-Path $Log)) { New-Item -ItemType File $Log | Out-Null }
  Get-Content $Log -Tail 50 -Wait -Encoding UTF8
}

function Uninstall-App {
  Stop-App
  if (Get-Task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
  Write-Host "✅ 已停止網站並移除自動啟動（log 保留在 $Log）"
}

switch ($Command) {
  'install' { Install-App }
  'restart' { Restart-App }
  'status' { Show-Status }
  'logs' { Show-Logs }
  'uninstall' { Uninstall-App }
  'password' { Set-Password }
  default {
    Write-Host @"
用法：$Self <指令>

  install     打包網頁並設定登入後自動在背景執行
  restart     修改程式後重新打包並重新啟動
  status      查看是否在執行
  logs        查看 log（Ctrl + C 離開）
  uninstall   停止網站並移除自動啟動
  password    設定、修改或取消登入密碼

重新執行 install 會保留已設定的密碼。
"@
    exit 1
  }
}
