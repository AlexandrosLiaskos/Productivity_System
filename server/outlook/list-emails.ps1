# list-emails.ps1 — List emails in a folder, most recent first
[Console]::OutputEncoding = [Text.Encoding]::UTF8
param(
    [Parameter(Mandatory=$true)]
    [string]$FolderPath,

    [int]$Limit = 50
)

function Resolve-Folder {
    param([string]$Path)
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace("MAPI")

    # FolderPath looks like: \\account@example.com\Inbox\Subfolder
    $parts = $Path -split '\\'
    # Remove empty entries from leading backslashes
    $parts = $parts | Where-Object { $_ -ne '' }

    if ($parts.Count -lt 1) { throw "Invalid folder path: $Path" }

    # First part is the store/account name, find it
    $root = $null
    foreach ($store in $namespace.Stores) {
        $storeRoot = $store.GetRootFolder()
        if ($storeRoot.Name -eq $parts[0] -or $store.DisplayName -eq $parts[0]) {
            $root = $storeRoot
            break
        }
    }
    if (-not $root) { throw "Store not found: $($parts[0])" }

    # Navigate remaining parts
    $current = $root
    for ($i = 1; $i -lt $parts.Count; $i++) {
        $found = $null
        foreach ($sub in $current.Folders) {
            if ($sub.Name -eq $parts[$i]) {
                $found = $sub
                break
            }
        }
        if (-not $found) { throw "Folder not found: $($parts[$i])" }
        $current = $found
    }
    return $current
}

try {
    $folder = Resolve-Folder -Path $FolderPath
    $items = $folder.Items
    $items.Sort("[ReceivedTime]", $true)  # descending

    $results = @()
    $count = 0
    foreach ($item in $items) {
        if ($count -ge $Limit) { break }
        # Only process mail items (class 43)
        if ($item.Class -ne 43) { continue }

        $toList = @()
        foreach ($recip in $item.Recipients) {
            if ($recip.Type -eq 1) { $toList += $recip.Address }
        }
        $ccList = @()
        foreach ($recip in $item.Recipients) {
            if ($recip.Type -eq 2) { $ccList += $recip.Address }
        }

        $sentDate = ""
        if ($item.SentOn) {
            $sentDate = $item.SentOn.ToString("yyyyMMdd")
        }

        $bodyText = ""
        if ($item.Body) {
            $bodyText = $item.Body
            if ($bodyText.Length -gt 200) { $bodyText = $bodyText.Substring(0, 200) }
            # Normalize whitespace for JSON
            $bodyText = $bodyText -replace "`r`n", " " -replace "`n", " " -replace "`r", " " -replace '\s+', ' '
        }

        $results += @{
            entryId         = $item.EntryID
            subject         = if ($item.Subject) { $item.Subject } else { "" }
            from            = if ($item.SenderEmailAddress) { $item.SenderEmailAddress } else { "" }
            to              = $toList
            cc              = $ccList
            date            = $sentDate
            hasAttachments  = [bool]$item.Attachments.Count
            attachmentCount = $item.Attachments.Count
            bodyPreview     = $bodyText
        }
        $count++
    }

    $json = $results | ConvertTo-Json -Depth 10 -Compress
    if ($results.Count -eq 0) { $json = "[]" }
    elseif ($results.Count -eq 1) { $json = "[$json]" }
    Write-Output $json
} catch {
    $msg = $_.Exception.Message -replace '"', '\"'
    Write-Output "{`"error`":`"$msg`"}"
}
