#Requires -Version 7.2
<#
.SYNOPSIS
  为 HuLa Windows 桌面端测试准备固定版本 WebView2 Runtime（149.0.4022.80）。

.DESCRIPTION
  WebView2 Evergreen 150.x 起不再读取 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 等环境变量，
  导致 CDP（--remote-debugging-port=9222）无法打开，自动化测试 attach 失败。
  本脚本下载并解压已知可用的 Fixed Version Runtime 149.0.4022.80，
  在当前 PowerShell 进程中设置必要环境变量，供 launch_app.ps1 / playwright 测试使用。

  必须与 debug 构建的 hula.exe 配合使用；release 构建会剥离这些环境变量。

.PARAMETER RuntimeDir
  固定运行时解压目录。默认：%LOCALAPPDATA%\HuLa\WebView2FixedRuntime\149.0.4022.80

.PARAMETER DownloadUrl
  Fixed Version Runtime .cab 下载地址。默认使用社区镜像的 Microsoft 官方二进制。

.PARAMETER SkipDownload
  如果本地已存在固定运行时，跳过下载/解压检查。

.EXAMPLE
  # 在 launch_app.ps1 开头 dot-source 本脚本
  . .\scripts\setup-webview2-runtime.ps1

  # 自定义目录
  . .\scripts\setup-webview2-runtime.ps1 -RuntimeDir D:\webview2-149
#>
param(
  [string]$RuntimeDir = (Join-Path $env:LOCALAPPDATA 'HuLa\WebView2FixedRuntime\149.0.4022.80'),
  [string]$DownloadUrl = 'https://github.com/libnyanpasu/webview2-runtime-archive/releases/download/149.0.4022.80/Microsoft.WebView2.FixedVersionRuntime.x64.cab',
  [switch]$SkipDownload
)

$ErrorActionPreference = 'Stop'

function Write-Info {
  param([string]$Message)
  Write-Host "[HuLa/WebView2] $Message" -ForegroundColor Cyan
}

function Write-ErrorExit {
  param([string]$Message)
  Write-Host "[HuLa/WebView2] $Message" -ForegroundColor Red
  exit 1
}

# 1. 检查或准备固定运行时目录
$msedgewebview2 = Join-Path $RuntimeDir 'msedgewebview2.exe'
$hasRuntime = Test-Path $msedgewebview2

if (-not $hasRuntime -and -not $SkipDownload) {
  $cacheDir = Split-Path -Parent $RuntimeDir
  $cabName = [System.IO.Path]::GetFileName($DownloadUrl)
  $cabPath = Join-Path $cacheDir $cabName

  if (-not (Test-Path $cacheDir)) {
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
  }

  # 1.1 下载 .cab（幂等：如果已存在且非空则复用）
  if (-not (Test-Path $cabPath) -or (Get-Item $cabPath).Length -eq 0) {
    Write-Info "正在下载 WebView2 Fixed Version Runtime 149.0.4022.80 ..."
    try {
      Invoke-WebRequest -Uri $DownloadUrl -OutFile $cabPath -UseBasicParsing
    } catch {
      Write-ErrorExit "下载失败：$_`n请检查网络，或手动下载 .cab 后放到：$cabPath"
    }
    Write-Info "下载完成：$cabPath"
  } else {
    Write-Info "复用已下载的 cab：$cabPath"
  }

  # 1.2 解压 .cab
  Write-Info "正在解压到 $RuntimeDir ..."
  if (-not (Test-Path $RuntimeDir)) {
    New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
  }

  $expand = Join-Path $env:SystemRoot 'System32\expand.exe'
  if (-not (Test-Path $expand)) {
    Write-ErrorExit '找不到系统 expand.exe，无法解压 .cab'
  }

  # expand 要求输出目录已存在
  & $expand $cabPath -F:* $RuntimeDir | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-ErrorExit "expand.exe 解压失败，exit code: $LASTEXITCODE"
  }

  # .cab 解压后通常嵌套一层版本号目录，把它提到 RuntimeDir 根
  $nested = Get-ChildItem -Path $RuntimeDir -Directory | Where-Object {
    Test-Path (Join-Path $_.FullName 'msedgewebview2.exe')
  } | Select-Object -First 1

  if ($nested) {
    Get-ChildItem -Path $nested.FullName | Move-Item -Destination $RuntimeDir -Force
    Remove-Item -Path $nested.FullName -Recurse -Force
  }

  if (-not (Test-Path $msedgewebview2)) {
    Write-ErrorExit "解压后仍未找到 msedgewebview2.exe，请检查 $RuntimeDir"
  }

  Write-Info "固定运行时准备完成：$RuntimeDir"
} elseif ($hasRuntime) {
  Write-Info "使用已有固定运行时：$RuntimeDir"
} else {
  Write-ErrorExit '未找到固定运行时，且 -SkipDownload 禁止下载。'
}

# 2. 设置环境变量（仅影响当前 PowerShell 进程）
$env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $RuntimeDir
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
# 每个测试进程使用独立 user data，避免与日常 HuLa 冲突
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:TEMP "hula-webview2-test-$(Get-Random)"

Write-Info "环境变量已设置："
Write-Info "  WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $env:WEBVIEW2_BROWSER_EXECUTABLE_FOLDER"
Write-Info "  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"
Write-Info "  WEBVIEW2_USER_DATA_FOLDER = $env:WEBVIEW2_USER_DATA_FOLDER"

# 3. 返回运行时路径，方便调用方使用
return $RuntimeDir
