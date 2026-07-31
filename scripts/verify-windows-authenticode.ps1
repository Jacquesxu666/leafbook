param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [Parameter(Mandatory = $true)][string]$InstalledExecutable,
  [Parameter(Mandatory = $true)][string]$ExpectedSignerThumbprint,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($ExpectedSignerThumbprint -cnotmatch '^[0-9A-F]{40}$') {
  throw 'Expected signer thumbprint must be exactly 40 uppercase hexadecimal characters.'
}
if (Test-Path -LiteralPath $Output) {
  throw 'Authenticode report output already exists.'
}

function Get-VerifiedSubject([string]$Role, [string]$Path, [string]$Name) {
  $item = Get-Item -LiteralPath $Path -Force
  if (-not $item.Exists -or $item.PSIsContainer -or $item.LinkType) {
    throw "Unsafe Authenticode subject: $Role"
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $item.FullName
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Authenticode validation failed for $Role with status $($signature.Status)."
  }
  $thumbprint = $signature.SignerCertificate.Thumbprint.ToUpperInvariant()
  if ($thumbprint -cne $ExpectedSignerThumbprint) {
    throw "Authenticode signer mismatch for $Role."
  }
  [ordered]@{
    name = $Name
    role = $Role
    sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    signerThumbprint = $thumbprint
    status = 'Valid'
  }
}

$report = [ordered]@{
  policy = 'authenticode-valid-v1'
  subjects = @(
    Get-VerifiedSubject 'setup' $Setup ([System.IO.Path]::GetFileName($Setup))
    Get-VerifiedSubject 'installed-executable' $InstalledExecutable 'leafbook.exe'
  )
}

$json = $report | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($Output, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
