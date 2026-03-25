# check-available.ps1 — Check if Outlook is installed via registry (does not launch Outlook)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
    $paths = @(
        'HKLM:\SOFTWARE\Microsoft\Office\*\Outlook',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Office\*\Outlook'
    )
    $found = $false
    foreach ($p in $paths) {
        $keys = Get-Item $p -ErrorAction SilentlyContinue
        if ($keys) { $found = $true; break }
    }
    if ($found) {
        Write-Output '{"available":true}'
    } else {
        Write-Output '{"available":false,"error":"Outlook not installed"}'
    }
} catch {
    $msg = $_.Exception.Message -replace '"', '\"'
    Write-Output "{`"available`":false,`"error`":`"Check failed: $msg`"}"
}
