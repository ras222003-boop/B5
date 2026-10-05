param([switch]$PromptForAzureKey)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $repo '.env.local'

function New-Secret {
  $bytes = New-Object byte[] 48
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

Push-Location $repo
try {
  git check-ignore -q -- .env.local
  if ($LASTEXITCODE -ne 0) { throw '.env.local must be ignored by Git before setup can continue.' }
  if (git ls-files -- .env.local) { throw '.env.local is tracked by Git; remove it from the index before setup.' }
  docker info --format '{{.ServerVersion}}' *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop daemon is unavailable. Start Docker Desktop, then rerun this script.' }

  $values = @{}
  $newFile = -not (Test-Path -LiteralPath $envPath)
  if (-not $newFile) {
    foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
      if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
    }
  }
  if (-not $values.ContainsKey('MYSQL_PASSWORD')) { $values['MYSQL_PASSWORD'] = New-Secret }
  if (-not $values.ContainsKey('MYSQL_ROOT_PASSWORD')) { $values['MYSQL_ROOT_PASSWORD'] = New-Secret }
  if (-not $values.ContainsKey('MANUS_JWT_SECRET')) { $values['MANUS_JWT_SECRET'] = New-Secret }
  if (-not $values.ContainsKey('DATABASE_URL')) {
    $values['DATABASE_URL'] = "mysql://basira:$($values['MYSQL_PASSWORD'])@127.0.0.1:3307/basira"
  }
  if (-not $values.ContainsKey('AZURE_SPEECH_KEY')) { $values['AZURE_SPEECH_KEY'] = '' }
  if ($PromptForAzureKey) {
    $secure = Read-Host 'Azure Speech key (input hidden)' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $values['AZURE_SPEECH_KEY'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  }
  $values['AZURE_SPEECH_REGION'] = 'uaenorth'
  $values['AZURE_TTS_ENABLED'] = 'true'
  $values['PREMIUM_TTS_ENABLED'] = 'true'
  $keys = @('DATABASE_URL','MANUS_JWT_SECRET','MYSQL_PASSWORD','MYSQL_ROOT_PASSWORD','AZURE_SPEECH_KEY','AZURE_SPEECH_REGION','AZURE_TTS_ENABLED','PREMIUM_TTS_ENABLED')
  $extra = @($values.Keys | Where-Object { $_ -notin $keys } | Sort-Object)
  $lines = @($keys + $extra | ForEach-Object { "$_=$($values[$_])" })
  [System.IO.File]::WriteAllText($envPath, ($lines -join "`n") + "`n", (New-Object System.Text.UTF8Encoding($false)))
  if ($newFile) {
    $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = Get-Acl -LiteralPath $envPath
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleAll($rule) }
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($me, 'FullControl', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $envPath -AclObject $acl
  }
  docker compose --env-file .env.local -f compose.yaml up -d --wait mysql
  if ($LASTEXITCODE -ne 0) { throw 'Basira MySQL did not become healthy. Check Docker Desktop and container logs.' }
  Write-Host 'Basira MySQL is healthy. Run pnpm dev; startup applies additive migrations.'
} finally { Pop-Location }
