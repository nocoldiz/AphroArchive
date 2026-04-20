# --- Configuration ---
$Model = "moondream"
$LogFile = "./rename_log.txt"
$AllowedExtensions = @(".jpg", ".jpeg", ".png", ".webp")

function Write-Log($Message) {
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $Entry = "[$Timestamp] $Message"
    Write-Host $Entry
    $Entry | Out-File -FilePath $LogFile -Append
}

# --- Initial Prompt ---
$UserChoice = Read-Host "Do you want to redo the whole renaming process from scratch? (y/n)"
$RedoAll = $UserChoice.Trim().ToLower() -eq 'y'

if ($RedoAll) {
    Write-Log "User selected REDO ALL. Skipping filters..."
}

Write-Log "Starting image captioning and renaming process..."

$Files = Get-ChildItem -Recurse | Where-Object { $_.Extension -in $AllowedExtensions }

foreach ($File in $Files) {
    $BaseName = $File.BaseName

    # --- Filtering Logic (Only run if $RedoAll is false) ---
    if (-not $RedoAll) {
        # 1. Check if it contains coordinates
        $IsCoordinate = $BaseName -match '\[[\d\s.,]+\]'
        
        # 2. Check if it contains NO letters (only numbers/symbols)
        $IsOnlyNumbers = $BaseName -notmatch '[a-zA-Z]'
        
        # 3. Check for "unidentified"
        $IsUnidentified = $BaseName -like "*unidentified*"

        # 4. Check for exclamation mark
        $ContainsExclamation = $BaseName -like "*!*"

        # If it's a "good" filename (has letters and no red flags), skip it
        if (-not $IsOnlyNumbers -and -not $IsCoordinate -and -not $IsUnidentified -and -not $ContainsExclamation) {
            Write-Log "Skipping already descriptive file: $($File.Name)"
            continue
        }
    }

    try {
        Write-Log "Processing: $($File.FullName)"

        $Bytes = [System.IO.File]::ReadAllBytes($File.FullName)
        $Base64Image = [Convert]::ToBase64String($Bytes)

        $Body = @{
            model  = $Model
            prompt = "Provide a short, 3-5 word descriptive title for this image. Do not use coordinates or technical jargon."
            stream = $false
            images = @($Base64Image)
        } | ConvertTo-Json

        $Response = Invoke-RestMethod -Uri "http://localhost:11434/api/generate" -Method Post -Body $Body -ContentType "application/json"
        
        Write-Host "AI Response: $($Response.response)" -ForegroundColor Cyan

        $Caption = $Response.response.Trim() -replace '[\\\/\:\*\?\"\<\>\|]', ''
        $Caption = $Caption -replace '\s+', '_' 
        
        if ($Caption -match '\w') {
            $NewName = "$Caption$($File.Extension)"
            $Destination = Join-Path -Path $File.DirectoryName -ChildPath $NewName
            
            if (Test-Path $Destination) {
                $NewName = "$Caption" + "_" + (Get-Random -Maximum 1000) + "$($File.Extension)"
            }

            Rename-Item -Path $File.FullName -NewName $NewName -ErrorAction Stop
            Write-Log "Renamed to: $NewName"
        } else {
            Write-Log "Warning: AI returned an empty string for $($File.Name)"
        }
    }
    catch {
        Write-Log "Error processing $($File.Name): $($_.Exception.Message)"
    }
}

Write-Log "Process complete."