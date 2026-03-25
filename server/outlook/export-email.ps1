# export-email.ps1 — Save .msg file and attachments to disk
[Console]::OutputEncoding = [Text.Encoding]::UTF8
param(
    [Parameter(Mandatory=$true)]
    [string]$EntryId,

    [Parameter(Mandatory=$true)]
    [string]$DestPath,

    [Parameter(Mandatory=$true)]
    [string]$MsgFilename
)

try {
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace("MAPI")
    $item = $namespace.GetItemFromID($EntryId)

    if (-not $item -or $item.Class -ne 43) {
        throw "Mail item not found or invalid"
    }

    # Ensure destination directory exists
    if (-not (Test-Path $DestPath)) {
        New-Item -ItemType Directory -Path $DestPath -Force | Out-Null
    }

    # Save the .msg file (olMSG format = 3)
    $msgFullPath = Join-Path $DestPath $MsgFilename
    $item.SaveAs($msgFullPath, 3)

    # Save attachments
    $attachmentNames = @()
    if ($item.Attachments.Count -gt 0) {
        # Attachment folder = MsgFilename without .msg extension
        $attachFolderName = $MsgFilename -replace '\.msg$', ''
        $attachDir = Join-Path $DestPath $attachFolderName
        if (-not (Test-Path $attachDir)) {
            New-Item -ItemType Directory -Path $attachDir -Force | Out-Null
        }

        foreach ($att in $item.Attachments) {
            # Use bare filename only — no path separators
            $safeName = $att.FileName -replace '[\\\/\:]', '_'
            $attPath = Join-Path $attachDir $safeName
            $att.SaveAsFile($attPath)
            $attachmentNames += $safeName
        }
    }

    $result = @{
        msgPath     = $msgFullPath
        attachments = $attachmentNames
    }

    $json = $result | ConvertTo-Json -Depth 5 -Compress
    if ($attachmentNames.Count -eq 1) {
        # Fix single-element array serialization
        $result.attachments = @($attachmentNames)
        $json = $result | ConvertTo-Json -Depth 5 -Compress
    }
    Write-Output $json
} catch {
    $msg = $_.Exception.Message -replace '"', '\"'
    Write-Output "{`"error`":`"$msg`"}"
}
