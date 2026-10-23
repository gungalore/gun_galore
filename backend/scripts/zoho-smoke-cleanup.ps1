# =====================================================================
# Zoho Books smoke-test cleanup
# =====================================================================
# Removes everything the marketplace/buyer smoke tests created:
#   - contacts whose name starts with SMOKETEST
#   - their customer payments and invoices
#   - Bob Go expenses whose reference starts with SMOKE-
#   - journals whose reference contains SMOKE-
#
# Dry run by default. Pass -Apply to delete.
# =====================================================================

param([switch]$Apply)

$ErrorActionPreference = 'Stop'
$creds = @{}
Get-Content (Join-Path $PSScriptRoot '..\.env') | ForEach-Object {
    if ($_ -match '^([A-Z0-9_]+)=(.+)$') { $creds[$Matches[1]] = $Matches[2].Trim() }
}
$apiDomain      = if ($creds['ZOHO_BOOKS_API_DOMAIN']) { $creds['ZOHO_BOOKS_API_DOMAIN'] } else { 'https://www.zohoapis.com' }
$accountsDomain = if ($creds['ZOHO_BOOKS_ACCOUNTS_DOMAIN']) { $creds['ZOHO_BOOKS_ACCOUNTS_DOMAIN'] } else { 'https://accounts.zoho.com' }
$orgId          = $creds['ZOHO_BOOKS_ORG_ID']
$q              = "organization_id=$orgId"

$t = Invoke-RestMethod -Method Post -Uri "$accountsDomain/oauth/v2/token" -Body @{
    grant_type = 'refresh_token'; client_id = $creds['ZOHO_BOOKS_CLIENT_ID'];
    client_secret = $creds['ZOHO_BOOKS_CLIENT_SECRET']; refresh_token = $creds['ZOHO_BOOKS_REFRESH_TOKEN']
}
$h = @{ Authorization = "Zoho-oauthtoken $($t.access_token)"; 'Content-Type' = 'application/json' }

function Get-All([string]$path) {
    $sep = if ($path.Contains('?')) { '&' } else { '?' }
    return Invoke-RestMethod -Uri "$apiDomain/books/v3$path$sep$q&per_page=200" -Headers $h
}
function Remove-One([string]$kind, [string]$id, [string]$label) {
    if (-not $Apply) { Write-Host "  would delete $kind $label ($id)" -ForegroundColor Yellow; return }
    try {
        Invoke-RestMethod -Method Delete -Uri "$apiDomain/books/v3/$kind/$id`?$q" -Headers $h | Out-Null
        Write-Host "  deleted $kind $label" -ForegroundColor Green
    } catch {
        Write-Host "  FAILED to delete $kind $label : $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "-> Finding SMOKETEST contacts..." -ForegroundColor Cyan
$contacts = (Get-All '/contacts').contacts | Where-Object { $_.contact_name -like 'SMOKETEST*' }
Write-Host "  $($contacts.Count) contact(s)"

$contactIds = @($contacts | ForEach-Object { $_.contact_id })

Write-Host "-> Finding customer payments for those contacts..." -ForegroundColor Cyan
$payments = (Get-All '/customerpayments').customerpayments | Where-Object { $contactIds -contains $_.customer_id }
Write-Host "  $($payments.Count) payment(s)"
foreach ($p in $payments) { Remove-One 'customerpayments' $p.payment_id "$($p.payment_number) $($p.customer_name)" }

Write-Host "-> Finding invoices for those contacts..." -ForegroundColor Cyan
$invoices = @()
foreach ($id in $contactIds) {
    $invoices += (Get-All "/invoices?customer_id=$id").invoices
}
$invoices = @($invoices | Where-Object { $_ })
Write-Host "  $($invoices.Count) invoice(s)"
foreach ($i in $invoices) { Remove-One 'invoices' $i.invoice_id "$($i.invoice_number) $($i.customer_name)" }

Write-Host "-> Finding smoke expenses..." -ForegroundColor Cyan
$expenses = (Get-All '/expenses').expenses | Where-Object { $_.reference_number -like 'SMOKE-*' }
Write-Host "  $($expenses.Count) expense(s)"
foreach ($e in $expenses) { Remove-One 'expenses' $e.expense_id "$($e.reference_number) $($e.total)" }

Write-Host "-> Finding smoke journals..." -ForegroundColor Cyan
$journals = (Get-All '/journals').journals | Where-Object { $_.reference_number -like '*SMOKE-*' }
Write-Host "  $($journals.Count) journal(s)"
foreach ($j in $journals) { Remove-One 'journals' $j.journal_id "$($j.reference_number)" }

Write-Host "-> Removing contacts..." -ForegroundColor Cyan
foreach ($c in $contacts) { Remove-One 'contacts' $c.contact_id $c.contact_name }

Write-Host ""
if (-not $Apply) { Write-Host "DRY RUN - re-run with -Apply to delete." -ForegroundColor Yellow }
else { Write-Host "Cleanup complete." -ForegroundColor Green }
