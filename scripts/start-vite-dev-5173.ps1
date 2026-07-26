param(
  [string]$NodeBin = "",
  [string]$HostName = "",
  [int]$Port = 0,
  [string]$PbDailyIntelligenceDir = "",
  [string]$PbDailyIntelligenceEngineDir = "",
  [string]$PbDailyIntelligencePython = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ScriptDir
$WebDir = Join-Path $AppDir "web"
$LogDir = Join-Path $AppDir "logs"
$ViteBin = Join-Path $WebDir "node_modules\vite\bin\vite.js"

if (-not $NodeBin) {
  if ($env:NODE_BIN) {
    $NodeBin = $env:NODE_BIN
  } else {
    $NodeBin = "node"
  }
}

if (-not $HostName) {
  if ($env:FINANCE_AGENT_GUI_HOST) {
    $HostName = $env:FINANCE_AGENT_GUI_HOST
  } else {
    $HostName = "127.0.0.1"
  }
}

if (-not $Port) {
  if ($env:FINANCE_AGENT_GUI_PORT) {
    $Port = [int]$env:FINANCE_AGENT_GUI_PORT
  } elseif ($env:PORT) {
    $Port = [int]$env:PORT
  } else {
    $Port = 5173
  }
}

if ($PbDailyIntelligenceDir) {
  $env:PB_DAILY_INTELLIGENCE_DIR = $PbDailyIntelligenceDir
}
if ($PbDailyIntelligenceEngineDir) {
  $env:PB_DAILY_INTELLIGENCE_ENGINE_DIR = $PbDailyIntelligenceEngineDir
}
if ($PbDailyIntelligencePython) {
  $env:PB_DAILY_INTELLIGENCE_PYTHON = $PbDailyIntelligencePython
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path $ViteBin)) {
  throw "Missing Vite entrypoint at $ViteBin. Run npm install from $WebDir."
}

$OutLog = Join-Path $LogDir "service-5173.out.log"
$ErrLog = Join-Path $LogDir "service-5173.err.log"

Set-Location $WebDir
& $NodeBin $ViteBin "--host" $HostName "--port" $Port "--strictPort" 1>> $OutLog 2>> $ErrLog
exit $LASTEXITCODE
