$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
try {
  $dialog.CheckFileExists = $true
  $dialog.Multiselect = $false
  $dialog.RestoreDirectory = $true
  if ($env:DRAFTLINE_PICK_KIND -eq 'engine') {
    $dialog.Title = 'Choose llama-server'
    $dialog.Filter = 'llama.cpp server (llama-server.exe)|llama-server.exe'
  } else {
    $dialog.Title = 'Open GGUF model'
    $dialog.Filter = 'GGUF models (*.gguf)|*.gguf|All files (*.*)|*.*'
  }
  $path = $null
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $path = $dialog.FileName }
  [Console]::Out.WriteLine(([pscustomobject]@{ path = $path } | ConvertTo-Json -Compress))
} finally { $dialog.Dispose() }
