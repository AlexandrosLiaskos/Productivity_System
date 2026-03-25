# list-folders.ps1 — Recursively list all Outlook folders as a JSON tree
[Console]::OutputEncoding = [Text.Encoding]::UTF8
param()

function Get-FolderTree {
    param([object]$Folder)
    $result = @{
        name       = $Folder.Name
        path       = $Folder.FolderPath
        count      = $Folder.Items.Count
        subfolders = @()
    }
    foreach ($sub in $Folder.Folders) {
        $result.subfolders += ,(Get-FolderTree -Folder $sub)
    }
    return $result
}

try {
    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace("MAPI")
    $topFolders = @()
    foreach ($store in $namespace.Stores) {
        $root = $store.GetRootFolder()
        foreach ($folder in $root.Folders) {
            $topFolders += ,(Get-FolderTree -Folder $folder)
        }
    }
    $json = $topFolders | ConvertTo-Json -Depth 20 -Compress
    # ConvertTo-Json wraps single-element arrays in a bare object; force array
    if ($topFolders.Count -eq 1) { $json = "[$json]" }
    Write-Output $json
} catch {
    $msg = $_.Exception.Message -replace '"', '\"'
    Write-Output "{`"error`":`"$msg`"}"
}
