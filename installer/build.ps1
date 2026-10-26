# Compiles ChordlineInstaller.exe with the C# compiler that ships with Windows (.NET Framework 4)
$ErrorActionPreference = "Stop"

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$out = Join-Path $PSScriptRoot "bin"
New-Item -ItemType Directory -Force $out | Out-Null

& $csc /nologo /target:winexe /optimize+ `
    /out:"$out\ChordlineInstaller.exe" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll `
    "$PSScriptRoot\ChordlineInstaller.cs"

if ($LASTEXITCODE -ne 0) { throw "Compiling the installer failed" }
Write-Host "Built $out\ChordlineInstaller.exe"
