<#
  make-dmg.ps1 — build a macOS-mountable .dmg from a staging folder on Windows.

  Windows has no hdiutil, so a true Apple UDIF image can't be produced here.
  Instead we write a UDF disk image (via the built-in IMAPI2 COM API) and give
  it a .dmg name. macOS mounts UDF images from a .dmg just like a normal disk
  image, and UDF preserves the full .app bundle structure (long names, nesting,
  case). Unix execute bits are not carried by IMAPI, so the staged setup.sh
  restores them with chmod — the same workaround the .zip flow already uses.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File make-dmg.ps1 `
      -SourceDir dist\mac-stage -VolumeName AphroArchive -Output dist\AphroArchive-mac.dmg
#>
param(
  [Parameter(Mandatory = $true)][string]$SourceDir,
  [Parameter(Mandatory = $true)][string]$Output,
  [string]$VolumeName = 'AphroArchive'
)

$ErrorActionPreference = 'Stop'

$SourceDir = (Resolve-Path -LiteralPath $SourceDir).Path
if (-not (Test-Path -LiteralPath $SourceDir)) { throw "Source folder not found: $SourceDir" }

$OutDir = Split-Path -Parent $Output
if ($OutDir -and -not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }

# Small helper that copies the COM image IStream out to a real file.
if (-not ('DmgWriter' -as [type])) {
  $code = @'
public class DmgWriter {
  public static void Write(string path, object stream, int blockSize, long totalBlocks) {
    var src = stream as System.Runtime.InteropServices.ComTypes.IStream;
    if (src == null) throw new System.Exception("Image stream is not an IStream");
    using (var dst = System.IO.File.Create(path)) {
      byte[] buffer = new byte[blockSize];
      System.IntPtr read = System.Runtime.InteropServices.Marshal.AllocHGlobal(8);
      try {
        while (totalBlocks-- > 0) {
          src.Read(buffer, blockSize, read);
          int got = System.Runtime.InteropServices.Marshal.ReadInt32(read);
          if (got <= 0) break;
          dst.Write(buffer, 0, got);
        }
        dst.Flush();
      } finally {
        System.Runtime.InteropServices.Marshal.FreeHGlobal(read);
      }
    }
  }
}
'@
  Add-Type -TypeDefinition $code
}

$fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
# 4 = UDF only (best filename/case fidelity for an .app bundle on macOS).
$fsi.FileSystemsToCreate = 4
$fsi.VolumeName = $VolumeName

# Add the contents of the staging folder at the image root (no base dir).
$fsi.Root.AddTree($SourceDir, $false)

$result = $fsi.CreateResultImage()
[DmgWriter]::Write($Output, $result.ImageStream, [int]$result.BlockSize, [long]$result.TotalBlocks)

if (-not (Test-Path -LiteralPath $Output)) { throw "DMG was not written: $Output" }
$size = [math]::Round((Get-Item -LiteralPath $Output).Length / 1MB, 1)
Write-Host "  wrote $Output ($size MB, UDF volume '$VolumeName')"
