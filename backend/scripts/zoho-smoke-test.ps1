# =====================================================================
# Zoho Books integration smoke test
# =====================================================================
# Exercises the same API patterns ZohoBooksService uses, against your
# live Books account, using sample numbers (R10,000 listing, R500
# commission). Creates ONE test contact, ONE test invoice, ONE test
# payment -- all clearly marked as smoke-test entries so you can delete
# them when you're done.
#
# Run:    powershell -ExecutionPolicy Bypass -File scripts\zoho-smoke-test.ps1
# Or:     (in PowerShell)   .\scripts\zoho-smoke-test.ps1
# =====================================================================

$ErrorActionPreference = 'Stop'

# ─── Load credentials from backend/.env ────────────────────────────────
$envPath = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envPath)) {
    Write-Error "Can't find .env at $envPath"
    exit 1
}
$creds = @{}
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.+)$') {
        $creds[$Matches[1]] = $Matches[2].Trim()
    }
}

$clientId       = $creds['ZOHO_BOOKS_CLIENT_ID']
$clientSecret   = $creds['ZOHO_BOOKS_CLIENT_SECRET']
$refreshToken   = $creds['ZOHO_BOOKS_REFRESH_TOKEN']
$orgId          = $creds['ZOHO_BOOKS_ORG_ID']
$apiDomain      = if ($creds['ZOHO_BOOKS_API_DOMAIN']) { $creds['ZOHO_BOOKS_API_DOMAIN'] } else { 'https://www.zohoapis.com' }
$accountsDomain = if ($creds['ZOHO_BOOKS_ACCOUNTS_DOMAIN']) { $creds['ZOHO_BOOKS_ACCOUNTS_DOMAIN'] } else { 'https://accounts.zoho.com' }

foreach ($k in 'ZOHO_BOOKS_CLIENT_ID','ZOHO_BOOKS_CLIENT_SECRET','ZOHO_BOOKS_REFRESH_TOKEN','ZOHO_BOOKS_ORG_ID') {
    if (-not $creds[$k]) {
        Write-Error "Missing $k in .env"
        exit 1
    }
}

# ─── Step 1: Get access token ──────────────────────────────────────────
Write-Host "-> Refreshing access token..." -ForegroundColor Cyan
$tokenResp = Invoke-RestMethod -Method Post -Uri "$accountsDomain/oauth/v2/token" -Body @{
    grant_type    = 'refresh_token'
    client_id     = $clientId
    client_secret = $clientSecret
    refresh_token = $refreshToken
}
$accessToken = $tokenResp.access_token
if (-not $accessToken) {
    Write-Error "Token refresh failed"
    $tokenResp | Format-List
    exit 1
}
Write-Host "  Access token: $($accessToken.Substring(0,20))... (expires in $($tokenResp.expires_in)s)" -ForegroundColor Green

$authHeader = @{ Authorization = "Zoho-oauthtoken $accessToken" }

# ─── Step 2: Look up the accounts we need ──────────────────────────────
Write-Host "-> Looking up Books accounts..." -ForegroundColor Cyan
$accounts = (Invoke-RestMethod -Uri "$apiDomain/books/v3/chartofaccounts?organization_id=$orgId" -Headers $authHeader).chartofaccounts
$commissionAcc = $accounts | Where-Object { $_.account_name -eq 'Commission Revenue' }
$cfpAcc = $accounts | Where-Object { $_.account_name -eq 'Client Funds Payable' }
if (-not $commissionAcc) { Write-Error "Commission Revenue account not found"; exit 1 }
if (-not $cfpAcc) { Write-Error "Client Funds Payable account not found"; exit 1 }
Write-Host "  Commission Revenue: $($commissionAcc.account_id)" -ForegroundColor Green
Write-Host "  Client Funds Payable: $($cfpAcc.account_id) (type: $($cfpAcc.account_type))" -ForegroundColor Green

# ─── Step 3: Create a test contact ─────────────────────────────────────
# Suffix the contact name with a timestamp so re-running the script
# doesn't collide with the previous run's contact (Books rejects
# duplicate contact_name).
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
Write-Host "-> Creating test contact (suffix $ts)..." -ForegroundColor Cyan
$contactBody = @{
    contact_name = "SMOKETEST -- DELETE ME -- $ts"
    contact_type = 'customer'
    contact_persons = @(@{
        first_name = 'Smoke'
        last_name = 'Test'
        email = 'smoketest@gungalore.co.za'
        is_primary_contact = $true
    })
    notes = 'Created by zoho-smoke-test.ps1 -- safe to delete after verifying the test invoice looks right.'
} | ConvertTo-Json -Depth 5

$contactResp = Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/contacts?organization_id=$orgId" `
    -Headers ($authHeader + @{ 'Content-Type' = 'application/json' }) -Body $contactBody
$contactId = $contactResp.contact.contact_id
if (-not $contactId) {
    Write-Error "Contact creation failed"
    $contactResp | Format-List
    exit 1
}
Write-Host "  Contact created: $contactId" -ForegroundColor Green

# ─── Step 4: Create the test invoice (commission) ──────────────────────
# Sample numbers -- R10,000 listing, R500 commission, R9,500 payout --
# matches the worked example from the accounting flow doc.
$listingPrice  = 10000.00
$commission    = 500.00
$sellerPayout  = $listingPrice - $commission

# Force en-US culture for thousands separator so we get a regular comma
# (R 10,000) instead of the en-ZA non-breaking space which renders as
# a U+FFFD replacement glyph in Zoho Books' PDF font.
$enUS = [System.Globalization.CultureInfo]::new('en-US')
$reference = "Sold for R $($listingPrice.ToString('N0', $enUS)) - R $($commission.ToString('N0', $enUS)) (Platform Fee) = R $($sellerPayout.ToString('N0', $enUS)) Due to you"

Write-Host "-> Creating commission invoice..." -ForegroundColor Cyan
Write-Host "  Reference: $reference" -ForegroundColor DarkGray
$today = Get-Date -Format 'yyyy-MM-dd'
$invoiceBody = @{
    customer_id      = $contactId
    reference_number = $reference
    date             = $today
    due_date         = $today
    line_items       = @(@{
        name        = 'Platform Fee'
        description = 'SMOKETEST-001 -- Test firearm listing (smoke test)'
        rate        = $commission
        quantity    = 1
        account_id  = $commissionAcc.account_id
    })
    notes = "$reference.`nGun Galore transaction reference: SMOKETEST-001"
} | ConvertTo-Json -Depth 5

$invResp = Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/invoices?organization_id=$orgId" `
    -Headers ($authHeader + @{ 'Content-Type' = 'application/json' }) -Body $invoiceBody
$invoiceId = $invResp.invoice.invoice_id
$invoiceNumber = $invResp.invoice.invoice_number
if (-not $invoiceId) {
    Write-Error "Invoice creation failed"
    $invResp | Format-List
    exit 1
}
Write-Host "  Invoice created: $invoiceNumber (id $invoiceId)" -ForegroundColor Green
Write-Host "    Total: R $commission" -ForegroundColor DarkGray
Write-Host "    Status: $($invResp.invoice.status)" -ForegroundColor DarkGray

# ─── Step 5: Mark invoice paid against Client Funds Payable ────────────
# This is THE test -- does Books accept a Liability account as the
# deposit_to_account? If yes, our ZB-5 design works as-is. If no, we
# need to switch to a Manual Journal posting pattern.
Write-Host "-> Recording payment against Client Funds Payable..." -ForegroundColor Cyan
$paymentBody = @{
    customer_id              = $contactId
    payment_mode             = 'Other'
    amount                   = $commission
    date                     = $today
    reference_number         = 'Settled from buyer funds -- SMOKETEST-001'
    deposit_to_account_id    = $cfpAcc.account_id
    invoices                 = @(@{
        invoice_id     = $invoiceId
        amount_applied = $commission
    })
    description = 'Smoke test -- commission settled by draining buyer funds held in trust'
} | ConvertTo-Json -Depth 5

try {
    $payResp = Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/customerpayments?organization_id=$orgId" `
        -Headers ($authHeader + @{ 'Content-Type' = 'application/json' }) -Body $paymentBody
    $paymentId = $payResp.payment.payment_id
    if (-not $paymentId) {
        Write-Error "Payment creation returned no payment_id"
        $payResp | Format-List
        exit 1
    }
    Write-Host "  Payment recorded: $paymentId" -ForegroundColor Green
    Write-Host "  Mark-paid against Client Funds Payable: WORKS" -ForegroundColor Green
} catch {
    Write-Host "  Payment creation FAILED" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "  This likely means Zoho Books does not allow a Liability" -ForegroundColor Yellow
    Write-Host "  account (Client Funds Payable) as deposit_to_account_id." -ForegroundColor Yellow
    Write-Host "  We'll need to switch ZB-5 to use a Manual Journal Entry" -ForegroundColor Yellow
    Write-Host "  pattern instead. The invoice itself is still created" -ForegroundColor Yellow
    Write-Host "  successfully -- only the mark-paid step failed." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Invoice ID for cleanup: $invoiceId" -ForegroundColor DarkGray
    Write-Host "  Contact ID for cleanup: $contactId" -ForegroundColor DarkGray
    exit 2
}

# ─── Summary ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor Green
Write-Host "  SMOKE TEST PASSED" -ForegroundColor Green
Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor Green
Write-Host ""
Write-Host "Created in your Books account:" -ForegroundColor White
Write-Host "  Contact:  $contactId" -ForegroundColor White
Write-Host "  Invoice:  $invoiceNumber ($invoiceId)" -ForegroundColor White
Write-Host "  Payment:  $paymentId" -ForegroundColor White
Write-Host ""
Write-Host "Go to Zoho Books -> Sales -> Invoices to see the test invoice." -ForegroundColor White
Write-Host "Look for invoice $invoiceNumber -- should be marked PAID." -ForegroundColor White
Write-Host ""
Write-Host "To clean up after you've inspected:" -ForegroundColor DarkGray
Write-Host "  - Open the invoice -> mark as Void or delete" -ForegroundColor DarkGray
Write-Host "  - Open the contact 'SMOKETEST -- DELETE ME' -> delete" -ForegroundColor DarkGray
Write-Host ""
