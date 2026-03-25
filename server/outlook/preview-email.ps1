# preview-email.ps1 — Get full email content for preview
[Console]::OutputEncoding = [Text.Encoding]::UTF8
param(
    [Parameter(Mandatory=$true)]
    [string]$EntryId
)

try {
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace("MAPI")
    $item = $namespace.GetItemFromID($EntryId)

    if (-not $item -or $item.Class -ne 43) {
        throw "Mail item not found or invalid"
    }

    $toList = @()
    $ccList = @()
    foreach ($recip in $item.Recipients) {
        if ($recip.Type -eq 1) { $toList += $recip.Address }
        elseif ($recip.Type -eq 2) { $ccList += $recip.Address }
    }

    $sentDate = ""
    if ($item.SentOn) {
        $sentDate = $item.SentOn.ToString("yyyyMMdd")
    }

    $bodyText = ""
    if ($item.Body) {
        $bodyText = $item.Body -replace "`r`n", "`n" -replace "`r", "`n"
    }

    $attachments = @()
    foreach ($att in $item.Attachments) {
        $attachments += @{
            name = $att.FileName
            size = $att.Size
        }
    }

    $result = @{
        entryId     = $item.EntryID
        subject     = if ($item.Subject) { $item.Subject } else { "" }
        from        = if ($item.SenderEmailAddress) { $item.SenderEmailAddress } else { "" }
        to          = $toList
        cc          = $ccList
        date        = $sentDate
        body        = $bodyText
        attachments = $attachments
    }

    $json = $result | ConvertTo-Json -Depth 10 -Compress
    Write-Output $json
} catch {
    $msg = $_.Exception.Message -replace '"', '\"'
    Write-Output "{`"error`":`"$msg`"}"
}
