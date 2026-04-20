param (
    [string]$TargetFolder = ".\",
    [string]$ModelName = "minicpm-v"
)

# 1. SETUP REAL-TIME DEBUG LOGGING
$LogPath = Join-Path -Path (Get-Location) -ChildPath "ollama_rename_debug.log"

# Custom function to guarantee immediate disk writes
function Write-Log {
    param (
        [string]$Message,
        [string]$Color = "White"
    )
    # 1. Print to screen
    Write-Host $Message -ForegroundColor $Color
    # 2. Immediately stamp and write to file
    $timestamp = (Get-Date).ToString("HH:mm:ss")
    "[$timestamp] $Message" | Out-File -FilePath $LogPath -Append -Encoding utf8
}

Write-Log "=== OLLAMA RENAME SCRIPT STARTED ===" "Cyan"
Write-Log "Raw Target Folder input: $TargetFolder"
Write-Log "Model Name: $ModelName"

# 2. RESOLVE AND VERIFY PATH
try {
    $resolvedFolder = (Resolve-Path $TargetFolder -ErrorAction Stop).Path
    Write-Log "Absolute Target Folder: $resolvedFolder"
} catch {
    Write-Log "[ERROR] Could not find the folder: $TargetFolder. Please check the path." "Red"
    exit
}

# 3. VERIFY FFMPEG
$ffmpegExists = Get-Command "ffmpeg" -ErrorAction SilentlyContinue
if (-not $ffmpegExists) {
    Write-Log "[WARNING] FFmpeg is not installed or not in PATH. Video/GIF files will be skipped." "Yellow"
} else {
    Write-Log "FFmpeg detected."
}

# 4. SEARCH FOR FILES
$imageExtensions = @('.jpg', '.jpeg', '.png', '.webp')

Write-Log "Scanning $resolvedFolder for media files..."

$allFiles = Get-ChildItem -Path $resolvedFolder -Recurse -File | Where-Object {
    $imageExtensions -contains $_.Extension.ToLower() -contains $_.Extension.ToLower()
}

if ($null -eq $allFiles -or $allFiles.Count -eq 0) {
    Write-Log "[RESULT] Found 0 media files. Exiting script." "Yellow"
    exit
}

Write-Log "[RESULT] Found $($allFiles.Count) media files. Starting AI analysis..." "Green"

# 5. PROCESS FILES
foreach ($file in $allFiles) {
    $ext = $file.Extension.ToLower()
    $imagePathToAnalyze = $file.FullName
    $tempFile = $false

    Write-Log "----------------------------------------"
    Write-Log "Processing: $($file.Name)"



    try {
        Write-Log "Sending to Ollama ($ModelName)..."
        $imageBytes = [System.IO.File]::ReadAllBytes($imagePathToAnalyze)
        $base64Image = [Convert]::ToBase64String($imageBytes)

        $prompt = "Analyze the image. Write a video title"
        
        $body = @{
            model = $ModelName
            prompt = $prompt
            stream = $false
            images = @($base64Image)
        } | ConvertTo-Json -Depth 10

        # Attempt API Call
        $response = Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method Post -Body $body -ContentType "application/json"
        
        $rawName = $response.response.Trim()
        Write-Log "Ollama raw response: $rawName"

        $safeName = $rawName -replace '[\\/:\*\?"<>\|]', '' -replace '\s+', '_' -replace '\.+', '' -replace '_+', '_'
        
        if ([string]::IsNullOrWhiteSpace($safeName)) {
            $safeName = "unidentified_subject"
            Write-Log "Ollama returned an empty response, using fallback name." "Yellow"
        }

        $newName = $safeName + $ext
        $newPath = Join-Path -Path $file.DirectoryName -ChildPath $newName
        $counter = 1
        
        while (Test-Path -Path $newPath) {
            if ($newPath -eq $file.FullName) { break } 
            $newName = "${safeName}_${counter}${ext}"
            $newPath = Join-Path -Path $file.DirectoryName -ChildPath $newName
            $counter++
        }

        if ($newPath -ne $file.FullName) {
            Rename-Item -Path $file.FullName -NewName $newName
            Write-Log "SUCCESS: Renamed to $newName" "Green"
        } else {
            Write-Log "Name is already correct. Skipping."
        }

    } catch {
        Write-Log "[ERROR] Failed during analysis or renaming. Details: $($_.Exception.Message)" "Red"
    } finally {
        if ($tempFile -and (Test-Path $imagePathToAnalyze)) {
            Remove-Item -Path $imagePathToAnalyze -Force
            Write-Log "Cleaned up temporary frame."
        }
    }
}

Write-Log "=== SCRIPT COMPLETE ===" "Cyan"