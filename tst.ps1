# 1. Empty the Recycle Bin for all drives without prompting
Write-Host "Emptying Recycle Bin..." -ForegroundColor Cyan
Clear-RecycleBin -Force -ErrorAction SilentlyContinue

# 2. Define the path for Explorer's cache
$CachePath = "$env:LocalAppData\Microsoft\Windows\Explorer"

# 3. Stop Windows Explorer to unlock the cache files
Write-Host "Stopping Explorer to release cache locks..." -ForegroundColor Cyan
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue

# Wait briefly for processes to terminate
Start-Sleep -Seconds 2

# 4. Remove Thumbnail and Icon cache databases
Write-Host "Deleting thumbnail and icon caches..." -ForegroundColor Cyan
Get-ChildItem -Path $CachePath -Filter "thumbcache_*.db" | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path $CachePath -Filter "iconcache_*.db" | Remove-Item -Force -ErrorAction SilentlyContinue

# 5. Restart Windows Explorer
Write-Host "Restarting Explorer..." -ForegroundColor Green
Start-Process explorer.exe

Write-Host "Cleanup complete!" -ForegroundColor White -BackgroundColor DarkGreen