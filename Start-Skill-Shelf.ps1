$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtime = Get-Command node -ErrorAction SilentlyContinue
if ($runtime) { $nodePath = $runtime.Source } else { $nodePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Please install Node.js 22 or newer, then run this launcher again.' }
Write-Host 'Open http://127.0.0.1:4318 in your browser. Keep this terminal open.'
& $nodePath (Join-Path $PSScriptRoot 'server.mjs')
