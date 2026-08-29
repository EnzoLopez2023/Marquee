<#
.SYNOPSIS
  Install the read-only Marquee Sonarr agent as a Windows scheduled task.

.DESCRIPTION
  Polls Sonarr on the LAN and pushes sanitized, compressed snapshots outbound to
  Marquee. The Sonarr API key is stored only in the gitignored local config.

  Unspecified settings are preserved from an existing config, so re-running the
  installer to rotate one token does not erase the others.

.EXAMPLE
  .\install-task.ps1 -MarqueeUrl "https://marquee.nintek.com" `
    -Token "<Sonarr ingest token>" -SonarrUrl "http://192.168.1.52:8989" `
    -ApiKey "<Sonarr API key>"

.EXAMPLE
  .\install-task.ps1 -Remove
#>
[CmdletBinding()]
param(
  [string] $TaskName = "MarqueeSonarrAgent",
  [string] $MarqueeUrl,
  [string] $Token,
  [string] $SonarrUrl,
  [string] $ApiKey,
  [int]    $PollMinutes = 0,
  [int]    $FullPollMinutes = 0,
  [switch] $Remove
)

$ErrorActionPreference = "Stop"
$supplied = $PSBoundParameters
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here "sonarr-agent.mjs"
$configPath = Join-Path $here "sonarr-agent.config.json"

function Normalize-MarqueeUrl([string] $Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "marqueeUrl is required." }
  try {
    $uri = [System.Uri]::new($Value.Trim(), [System.UriKind]::Absolute)
  } catch {
    throw "marqueeUrl must be an absolute HTTPS URL."
  }
  if (-not $uri.IsWellFormedOriginalString()) {
    throw "marqueeUrl must be a well-formed absolute URL."
  }
  if ($uri.UserInfo) { throw "marqueeUrl must not contain credentials." }
  if ($uri.Scheme -eq 'https') { return $uri.AbsoluteUri.TrimEnd('/') }
  if ($uri.Scheme -ne 'http') {
    throw "marqueeUrl must use HTTPS."
  }

  $rawAuthority = [regex]::Match($Value.Trim(), '^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]*)').Groups[1].Value
  if (-not $rawAuthority -or $rawAuthority.Contains('@')) {
    throw "marqueeUrl must use a canonical loopback host without credentials."
  }
  $rawHost = $rawAuthority -replace ':\d+$', ''
  $host = $uri.Host
  $isLoopback = ($rawHost -ieq 'localhost' -and $host -ieq 'localhost') `
    -or ($rawHost -eq '[::1]' -and ($host -eq '[::1]' -or $host -eq '::1'))
  if (-not $isLoopback) {
    $ip = $null
    if ($rawHost -ceq $host -and [System.Net.IPAddress]::TryParse($host, [ref] $ip)) {
      $bytes = $ip.GetAddressBytes()
      $isLoopback = $ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $bytes[0] -eq 127
    }
  }
  if (-not $isLoopback) {
    throw "marqueeUrl must use HTTPS unless it is localhost, 127.0.0.0/8, or [::1]."
  }
  return $uri.AbsoluteUri.TrimEnd('/')
}

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed task '$TaskName'."
  } else {
    Write-Host "Task '$TaskName' was not registered."
  }
  return
}

if (-not (Test-Path $script)) { throw "Cannot find $script" }
$deliveryHelper = Join-Path (Split-Path -Parent $here) "agentDelivery.mjs"
if (-not (Test-Path $deliveryHelper)) {
  throw "Cannot find shared delivery helper $deliveryHelper. Deploy the complete scripts folder, not only sonarr-agent."
}
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node.exe not found on PATH. Install Node 18+ and re-run." }

$config = [ordered]@{}
if (Test-Path $configPath) {
  Write-Host "Existing config found; unspecified settings will be preserved."
  $existing = Get-Content $configPath -Raw | ConvertFrom-Json
  foreach ($property in $existing.PSObject.Properties) {
    $config[$property.Name] = $property.Value
  }
}

if ($supplied.ContainsKey('MarqueeUrl')) { $config['marqueeUrl'] = $MarqueeUrl.TrimEnd('/') }
if ($supplied.ContainsKey('Token')) { $config['ingestToken'] = $Token }
if ($supplied.ContainsKey('SonarrUrl')) { $config['sonarrUrl'] = $SonarrUrl.TrimEnd('/') }
if ($supplied.ContainsKey('ApiKey')) { $config['sonarrApiKey'] = $ApiKey }
if ($supplied.ContainsKey('PollMinutes') -and $PollMinutes -gt 0) {
  $config['pollMinutes'] = $PollMinutes
}
if ($supplied.ContainsKey('FullPollMinutes') -and $FullPollMinutes -gt 0) {
  $config['fullPollMinutes'] = $FullPollMinutes
}

if (-not $config.Contains('sonarrUrl')) { $config['sonarrUrl'] = "http://192.168.1.52:8989" }
if (-not $config.Contains('pollMinutes')) { $config['pollMinutes'] = 2 }
if (-not $config.Contains('fullPollMinutes')) { $config['fullPollMinutes'] = 30 }
if (-not $config.Contains('shipLogs')) { $config['shipLogs'] = $true }

$required = @('marqueeUrl', 'ingestToken', 'sonarrUrl', 'sonarrApiKey')
foreach ($key in $required) {
  if (-not $config.Contains($key) -or -not $config[$key]) {
    throw "Missing $key. Pass the corresponding installer parameter."
  }
}
$config['marqueeUrl'] = Normalize-MarqueeUrl ([string] $config['marqueeUrl'])

$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true, $false)
foreach ($who in @("BUILTIN\Administrators", "NT AUTHORITY\SYSTEM")) {
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($who, "FullControl", "Allow")))
}
$tempConfigPath = "$configPath.new"
$stream = $null
$writer = $null
try {
  if (Test-Path $tempConfigPath) {
    throw "Candidate config path already exists: $tempConfigPath"
  }
  Add-Type -AssemblyName System.IO.FileSystem.AccessControl
  $stream = [System.IO.FileSystemAclExtensions]::Create(
    [System.IO.FileInfo]::new($tempConfigPath),
    [System.IO.FileMode]::CreateNew,
    [System.Security.AccessControl.FileSystemRights]::Write,
    [System.IO.FileShare]::None,
    4096,
    [System.IO.FileOptions]::WriteThrough,
    $acl
  )
  $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
  $writer.Write(($config | ConvertTo-Json -Depth 5))
  $writer.Flush()
  $stream.Flush($true)
  $writer.Dispose()
  $writer = $null
  $stream = $null

  Write-Host ""
  Write-Host "Checking Sonarr API access before promoting config..."
  & $node $script --check --config $tempConfigPath
  if ($LASTEXITCODE -ne 0) {
    throw "Sonarr check failed. The active config was not changed and the scheduled task was not installed."
  }

  Move-Item $tempConfigPath $configPath -Force
} finally {
  if ($writer) { $writer.Dispose() }
  elseif ($stream) { $stream.Dispose() }
  if (Test-Path $tempConfigPath) { Remove-Item $tempConfigPath -Force }
}
Write-Host "Wrote config -> $configPath"
Write-Host "Restricted config ACL to Administrators/SYSTEM."

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started '$TaskName'."
Write-Host "Sonarr API key remains in the local ACL-restricted config only."
