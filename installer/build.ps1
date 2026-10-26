# Compiles ChordlineInstaller.exe with the C# compiler that ships with Windows (.NET Framework 4)
# Two passes: the first build draws the logo into an .ico, the second embeds it as the exe's icon.
$ErrorActionPreference = "Stop"

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$out = Join-Path $PSScriptRoot "bin"
$exe = Join-Path $out "ChordlineInstaller.exe"
$icon = Join-Path $out "chordline.ico"
New-Item -ItemType Directory -Force $out | Out-Null

function Compile([string[]] $extra) {
    & $csc /nologo /target:winexe /optimize+ `
        /out:"$exe" `
        /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll `
        @extra `
        "$PSScriptRoot\ChordlineInstaller.cs"
    if ($LASTEXITCODE -ne 0) { throw "Compiling the installer failed" }
}

Compile @()
Start-Process -FilePath $exe -ArgumentList "--write-icon", "`"$icon`"" -Wait
if (-not (Test-Path $icon)) { throw "Creating the icon failed" }
Compile @("/win32icon:$icon")

Write-Host "Built $exe"
