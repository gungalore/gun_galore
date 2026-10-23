# =====================================================================
# Zoho Books buyer + carrier smoke test
# =====================================================================
# Mirrors the production BUY_NOW paperwork for one sale:
#
#   Item (seller's supply, collected on their behalf)   R 1,000.00
#   Bob Go carrier quote                                R   145.00
#   GG delivery margin (10% of carrier, folded in)      R    14.50
#   Delivery shown to buyer                             R   159.50
#   Platform Fee (10% of item + delivery)               R   115.95
#   Buyer total                                         R 1,275.45
#
# Creates, against the live Books org:
#   1. buyer contact
#   2. buyer invoice — item + delivery to Client Funds Payable, fee to revenue
#   3. customer payment settling that invoice from Client Funds Payable
#   4. delivery-margin journal (CFP -> Shipping Handling Revenue)
#   5. Bob Go vendor (if absent) + carrier expense for R145
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts\zoho-buyer-smoke-test.ps1
# Options:
#   -ListAccounts  list chart of accounts / vendors / bank accounts, no writes
#   -CleanupOld    delete the first run's draft INV-000003 + its test contact
# =====================================================================

param(
    [switch]$ListAccounts,
    [switch]$ListInvoices,
    [string]$GetInvoiceId,
    [switch]$TestExpense,
    [switch]$CleanupOld,
    [switch]$CleanupRuns
)

$ErrorActionPreference = 'Stop'

$envPath = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envPath)) {
    Write-Error "Can't find .env at $envPath"
    exit 1
}

$creds = @{}
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^([A-Z0-9_]+)=(.+)$') {
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

if ($creds['ZOHO_BOOKS_ENABLED'] -ne 'true') {
    Write-Host "WARNING: ZOHO_BOOKS_ENABLED is not 'true' in .env. The app itself would skip these API calls." -ForegroundColor Yellow
}

# ─── Auth ──────────────────────────────────────────────────────────────
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
Write-Host "  Access token acquired (expires in $($tokenResp.expires_in)s)" -ForegroundColor Green
$authHeader = @{ Authorization = "Zoho-oauthtoken $accessToken" }
$jsonHeaders = $authHeader + @{ 'Content-Type' = 'application/json' }

function Get-Accounts {
    return (Invoke-RestMethod -Uri "$apiDomain/books/v3/chartofaccounts?organization_id=$orgId" -Headers $authHeader).chartofaccounts
}
$accounts = Get-Accounts

function Find-Account([string[]]$names) {
    foreach ($n in $names) {
        $hit = $accounts | Where-Object { $_.account_name -eq $n } | Select-Object -First 1
        if ($hit) { return $hit }
    }
    return $null
}

# ─── Optional: remove the failed iteration artefacts ───────────────────
# Keeps the final INV-000010 / contact 136287000000252001 / expense
# 136287000000254001 and the Bob Go vendor.
if ($CleanupRuns) {
    Write-Host "-> Removing failed-run artefacts..." -ForegroundColor Cyan
    $paymentIds = @('136287000000251002')
    $invoiceIds = @(
        '136287000000238001', # INV-000004
        '136287000000240001', # INV-000005
        '136287000000242001', # INV-000006
        '136287000000245001', # INV-000007
        '136287000000247001', # INV-000008
        '136287000000240009'  # INV-000009
    )
    $expenseIds = @('136287000000241011') # standalone -TestExpense
    $contactIds = @(
        '136287000000235009',
        '136287000000236002',
        '136287000000234010',
        '136287000000244001',
        '136287000000246011',
        '136287000000249001'
    )

    foreach ($id in $paymentIds) {
        try { Invoke-RestMethod -Method Delete -Uri "$apiDomain/books/v3/customerpayments/${id}?organization_id=$orgId" -Headers $authHeader | Out-Null; Write-Host "  deleted payment $id" -ForegroundColor Green }
        catch { Write-Host "  payment ${id}: $($_.Exception.Message)" -ForegroundColor Yellow }
    }
    foreach ($id in $expenseIds) {
        try { Invoke-RestMethod -Method Delete -Uri "$apiDomain/books/v3/expenses/${id}?organization_id=$orgId" -Headers $authHeader | Out-Null; Write-Host "  deleted expense $id" -ForegroundColor Green }
        catch { Write-Host "  expense ${id}: $($_.Exception.Message)" -ForegroundColor Yellow }
    }
    foreach ($id in $invoiceIds) {
        try { Invoke-RestMethod -Method Delete -Uri "$apiDomain/books/v3/invoices/${id}?organization_id=$orgId" -Headers $authHeader | Out-Null; Write-Host "  deleted invoice $id" -ForegroundColor Green }
        catch { Write-Host "  invoice ${id}: $($_.Exception.Message)" -ForegroundColor Yellow }
    }
    foreach ($id in $contactIds) {
        try { Invoke-RestMethod -Method Delete -Uri "$apiDomain/books/v3/contacts/${id}?organization_id=$orgId" -Headers $authHeader | Out-Null; Write-Host "  deleted contact $id" -ForegroundColor Green }
        catch { Write-Host "  contact ${id}: $($_.Exception.Message)" -ForegroundColor Yellow }
    }
    exit 0
}

# ─── Optional: fetch one invoice ───────────────────────────────────────
if ($GetInvoiceId) {
    $url = "$apiDomain/books/v3/invoices/${GetInvoiceId}?organization_id=$orgId"
    Write-Host "GET $url" -ForegroundColor Cyan
    try {
        $one = (Invoke-RestMethod -Uri $url -Headers $authHeader).invoice
        $one | Select-Object invoice_number, invoice_id, status, total, balance, reference_number |
            Format-List
    } catch {
        Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
    }
    exit 0
}

# ─── Optional: inspect invoices only ───────────────────────────────────
if ($ListInvoices) {
    Write-Host "RECENT INVOICES" -ForegroundColor Cyan
    (Invoke-RestMethod -Uri "$apiDomain/books/v3/invoices?per_page=20&organization_id=$orgId" -Headers $authHeader).invoices |
        Select-Object invoice_number, invoice_id, status, total, balance, customer_name, created_time |
        Format-Table -AutoSize
    exit 0
}

# ─── Optional: inspect only ────────────────────────────────────────────
if ($ListAccounts) {
    Write-Host "INCOME / EXPENSE ACCOUNTS" -ForegroundColor Cyan
    $accounts |
        Where-Object { $_.account_type -in @('income','expense','cost_of_goods_sold','other_income','other_expense') } |
        Sort-Object account_type, account_name |
        Format-Table account_name, account_type, account_id -AutoSize
    Write-Host "BANK / ASSET / LIABILITY ACCOUNTS" -ForegroundColor Cyan
    $accounts |
        Where-Object { $_.account_type -in @('bank','cash','other_asset','other_current_asset','other_current_liability','accounts_payable','accounts_receivable') } |
        Sort-Object account_type, account_name |
        Format-Table account_name, account_type, account_id -AutoSize
    try {
        Write-Host "VENDORS / SUPPLIERS" -ForegroundColor Cyan
        (Invoke-RestMethod -Uri "$apiDomain/books/v3/contacts?contact_type=vendor&per_page=200&organization_id=$orgId" -Headers $authHeader).contacts |
            Select-Object contact_name, contact_id, status |
            Format-Table -AutoSize
    } catch {
        Write-Host "  (vendor list failed: $($_.Exception.Message))" -ForegroundColor Yellow
    }
    exit 0
}

# ─── Optional: remove the first broken run ─────────────────────────────
if ($CleanupOld) {
    Write-Host "-> Removing first-run artefacts..." -ForegroundColor Cyan
    foreach ($invId in '136287000000235001') {
        try {
            Invoke-RestMethod -Method Delete -Uri "$apiDomain/books/v3/invoices/${invId}?organization_id=$orgId" -Headers $authHeader | Out-Null
            Write-Host "  Deleted draft invoice $invId" -ForegroundColor Green
        } catch {
            Write-Host "  Could not delete invoice $invId (may already be gone): $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    foreach ($contactId in '136287000000234001') {
        try {
            Invoke-RestMethod -Method Delete -Uri "$apiDomain/books/v3/contacts/${contactId}?organization_id=$orgId" -Headers $authHeader | Out-Null
            Write-Host "  Deleted test contact $contactId" -ForegroundColor Green
        } catch {
            Write-Host "  Could not delete contact $contactId (may already be gone): $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
    exit 0
}

# ─── Resolve the accounts the service uses ─────────────────────────────
Write-Host "-> Looking up Books accounts..." -ForegroundColor Cyan
$feeAcc = Find-Account @('Platform Fee Revenue','Processing Fee Revenue','Commission Revenue')
if (-not $feeAcc) { Write-Error "No fee revenue account found in Books"; exit 1 }
$handlingAcc = Find-Account @('Shipping Handling Revenue','Delivery Handling Revenue','Shipping Charge','Delivery Revenue')
$usingHandlingFallback = $false
if (-not $handlingAcc) { $handlingAcc = $feeAcc; $usingHandlingFallback = $true }

$carrierAcc = Find-Account @('Courier and Delivery Costs','Cost of Goods Sold','Postage')
if (-not $carrierAcc) { Write-Error "No carrier cost account found in Books"; exit 1 }
$cfpAcc = Find-Account @('Client Funds Payable')
if (-not $cfpAcc) { Write-Error "Client Funds Payable account not found"; exit 1 }

Write-Host "  Platform Fee -> $($feeAcc.account_name) ($($feeAcc.account_id))" -ForegroundColor Green
if ($usingHandlingFallback) {
    Write-Host "  Delivery margin -> FALLBACK $($handlingAcc.account_name) (Shipping Handling Revenue is MISSING)" -ForegroundColor Yellow
} else {
    Write-Host "  Delivery margin -> $($handlingAcc.account_name) ($($handlingAcc.account_id))" -ForegroundColor Green
}
Write-Host "  Carrier cost -> $($carrierAcc.account_name) ($($carrierAcc.account_id))" -ForegroundColor Green
Write-Host "  Held funds -> $($cfpAcc.account_name) ($($cfpAcc.account_id))" -ForegroundColor Green

if ($TestExpense) {
    $vendors = (Invoke-RestMethod -Uri "$apiDomain/books/v3/contacts?contact_type=vendor&per_page=200&organization_id=$orgId" -Headers $authHeader).contacts
    $vendor = $vendors | Where-Object { $_.contact_name -eq 'Bob Go' } | Select-Object -First 1
    if (-not $vendor) { Write-Error "Bob Go vendor missing"; exit 1 }
    $body = @{
        vendor_id              = $vendor.contact_id
        account_id             = $carrierAcc.account_id
        date                   = (Get-Date -Format 'yyyy-MM-dd')
        amount                 = 145
        paid_through_account_id = $cfpAcc.account_id
        reference_number       = 'SMOKE-BN-001'
        description            = 'Courier delivery -- SMOKE-BN-001'
    } | ConvertTo-Json -Depth 6
    Write-Host "POST /expenses body: $body" -ForegroundColor DarkGray
    try {
        $r = Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/expenses?organization_id=$orgId" -Headers $jsonHeaders -Body $body
        $r | ConvertTo-Json -Depth 6
    } catch {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host "Expense error body: $($reader.ReadToEnd())" -ForegroundColor Red
    }
    exit 0
}


# ─── Exact maths from fee.calculator.ts ────────────────────────────────
$itemCents       = 100000
$carrierCents    = 14500
$handlingCents   = [int][Math]::Round($carrierCents * 0.10)
$deliveryCents   = $carrierCents + $handlingCents
$feeCents        = [int][Math]::Round(($itemCents + $deliveryCents) * 0.10)
$buyerTotalCents = $itemCents + $deliveryCents + $feeCents

$enUS = [System.Globalization.CultureInfo]::new('en-US')
function Format-Zar([int]$cents) {
    $pattern = if ($cents % 100 -eq 0) { 'N0' } else { 'N2' }
    'R ' + ($cents / 100).ToString($pattern, $enUS)
}

Write-Host "-> Scenario" -ForegroundColor Cyan
Write-Host "  Item:          $(Format-Zar $itemCents)"
Write-Host "  Bob Go quote:  $(Format-Zar $carrierCents)"
Write-Host "  Handling 10%:  $(Format-Zar $handlingCents)"
Write-Host "  Delivery:      $(Format-Zar $deliveryCents)"
Write-Host "  Platform Fee:  $(Format-Zar $feeCents)"
Write-Host "  Buyer total:   $(Format-Zar $buyerTotalCents)"
Write-Host "  Seller payout: $(Format-Zar $itemCents) (BUY_NOW commission = R0 -> no seller invoice)"

$orderRef = 'SMOKE-BN-001'
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'

# ─── Buyer contact ─────────────────────────────────────────────────────
Write-Host "-> Creating buyer test contact (suffix $ts)..." -ForegroundColor Cyan
$contactBody = @{
    contact_name = "SMOKETEST -- DELETE ME -- BUYER -- $ts"
    contact_type = 'customer'
    contact_persons = @(@{
        first_name = 'Smoke'
        last_name = 'Buyer'
        email = "smoketest-buyer-$ts@example.com"
        is_primary_contact = $true
    })
    notes = 'Created by zoho-buyer-smoke-test.ps1 -- safe to delete after verifying the buyer invoice.'
} | ConvertTo-Json -Depth 5

$contactResp = Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/contacts?organization_id=$orgId" `
    -Headers $jsonHeaders -Body $contactBody
$contactId = $contactResp.contact.contact_id
if (-not $contactId) { Write-Error "Contact creation failed"; $contactResp | Format-List; exit 1 }
Write-Host "  Contact created: $contactId" -ForegroundColor Green

# ─── Bob Go vendor ─────────────────────────────────────────────────────
$vendors = (Invoke-RestMethod -Uri "$apiDomain/books/v3/contacts?contact_type=vendor&per_page=200&organization_id=$orgId" -Headers $authHeader).contacts
$vendor = $vendors | Where-Object { $_.contact_name -eq 'Bob Go' } | Select-Object -First 1
if (-not $vendor) {
    Write-Host "-> Creating Bob Go vendor..." -ForegroundColor Cyan
    $vendorBody = @{
        contact_name = 'Bob Go'
        contact_type = 'vendor'
        notes = 'Courier rail supplier -- auto-created by ALL Outdoor'
    } | ConvertTo-Json -Depth 4
    $vendorResp = Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/contacts?organization_id=$orgId" `
        -Headers $jsonHeaders -Body $vendorBody
    $vendor = $vendorResp.contact
    Write-Host "  Vendor created: $($vendor.contact_id)" -ForegroundColor Green
} else {
    Write-Host "  Bob Go vendor exists: $($vendor.contact_id)" -ForegroundColor Green
}

# ─── Buyer invoice ─────────────────────────────────────────────────────
$itemRand     = $itemCents / 100
$feeRand      = $feeCents / 100
$deliveryRand = $deliveryCents / 100

$fullReference = "$orderRef`: item $(Format-Zar $itemCents) + delivery $(Format-Zar $deliveryCents) + fee $(Format-Zar $feeCents)"
$reference = if ($fullReference.Length -le 100) { $fullReference } else { "$orderRef`: item $(Format-Zar $itemCents) + fee $(Format-Zar $feeCents)" }
$notes = "ALL Outdoor acts as agent for the seller. The item price $(Format-Zar $itemCents) and courier delivery $(Format-Zar $deliveryCents) are collected on behalf of the seller and carrier and are held in Client Funds Payable; they are not revenue of ALL Outdoor. Only the Platform Fee $(Format-Zar $feeCents) is charged by ALL Outdoor.`nALL Outdoor transaction reference: $orderRef"

$lineItems = @(
    @{
        name        = 'Test item'
        description = "$orderRef -- sold by @smoke_seller (principal). ALL Outdoor acts as agent."
        rate        = $itemRand
        quantity    = 1
        account_id  = $cfpAcc.account_id
    },
    @{
        name        = 'Delivery'
        description = "$orderRef -- courier freight and delivery"
        rate        = $deliveryRand
        quantity    = 1
        account_id  = $cfpAcc.account_id
    },
    @{
        name        = 'Platform Fee'
        description = "$orderRef -- marketplace facilitation (ALL Outdoor agency service)"
        rate        = $feeRand
        quantity    = 1
        account_id  = $feeAcc.account_id
    }
)

$today = Get-Date -Format 'yyyy-MM-dd'
Write-Host "-> Creating buyer invoice..." -ForegroundColor Cyan
Write-Host "  Reference: $reference" -ForegroundColor DarkGray
$invoiceBody = @{
    customer_id      = $contactId
    reference_number = $reference
    date             = $today
    line_items       = $lineItems
    notes            = $notes
} | ConvertTo-Json -Depth 6

$invResp = Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/invoices?organization_id=$orgId" `
    -Headers $jsonHeaders -Body $invoiceBody
$invoiceId = $invResp.invoice.invoice_id
$invoiceNumber = $invResp.invoice.invoice_number
if (-not $invoiceId) { Write-Error "Buyer invoice creation failed"; $invResp | Format-List; exit 1 }
Write-Host "  Invoice created: $invoiceNumber (id $invoiceId)" -ForegroundColor Green

# Mark sent WITHOUT emailing (the email endpoint is /invoices/:id/email).
Write-Host "-> Marking invoice sent (no email)..." -ForegroundColor Cyan
Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/invoices/$invoiceId/status/sent?organization_id=$orgId" `
    -Headers $jsonHeaders -Body '{}' | Out-Null

# Books can take a moment to expose a just-created invoice to GET.
function Get-Invoice([string]$id) {
    for ($i = 0; $i -lt 6; $i++) {
        try {
            return (Invoke-RestMethod -Uri "$apiDomain/books/v3/invoices/${id}?organization_id=$orgId" -Headers $authHeader).invoice
        } catch {
            if ($i -eq 5) { throw }
            Start-Sleep -Milliseconds 800
        }
    }
}

function Get-Expense([string]$id) {
    for ($i = 0; $i -lt 6; $i++) {
        try {
            return (Invoke-RestMethod -Uri "$apiDomain/books/v3/expenses/${id}?organization_id=$orgId" -Headers $authHeader).expense
        } catch {
            if ($i -eq 5) { throw }
            Start-Sleep -Milliseconds 800
        }
    }
}

# Settle from Client Funds Payable.
$inv = Get-Invoice $invoiceId
$balance = [double]$inv.balance
Write-Host "-> Settling $(Format-Zar ([int][Math]::Round($balance * 100))) from $($cfpAcc.account_name)..." -ForegroundColor Cyan
$paymentBody = @{
    customer_id           = $contactId
    payment_mode          = 'others'
    amount                = $balance
    date                  = $today
    reference_number      = "Platform charges -- $orderRef"
    deposit_to_account_id = $cfpAcc.account_id
    invoices              = @(@{
        invoice_id     = $invoiceId
        amount_applied = $balance
    })
    description = 'Smoke test -- platform fee and delivery settled from buyer funds held in trust'
} | ConvertTo-Json -Depth 6

try {
    $payResp = Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/customerpayments?organization_id=$orgId" `
        -Headers $jsonHeaders -Body $paymentBody
} catch {
    Write-Host "  Payment payload: $paymentBody" -ForegroundColor DarkGray
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host "  Payment error body: $($reader.ReadToEnd())" -ForegroundColor Red
    } catch {
        Write-Host "  Payment error: $($_.Exception.Message)" -ForegroundColor Red
    }
    throw
}
$paymentId = $payResp.payment.payment_id
if (-not $paymentId) { Write-Error "Buyer payment creation failed"; $payResp | Format-List; exit 1 }
Write-Host "  Payment recorded: $paymentId" -ForegroundColor Green

# ─── Delivery-margin journal ───────────────────────────────────────────
# The buyer sees one Delivery figure (freight + margin) which the invoice
# posts to Client Funds Payable. This journal moves only the margin slice to
# delivery income, leaving the carrier's pure rate as the remaining liability.
Write-Host "-> Moving delivery margin out of held funds..." -ForegroundColor Cyan
$journalBody = @{
    journal_date     = $today
    reference_number = "Delivery margin -- $orderRef"
    notes            = "Delivery handling margin stripped from courier freight collected on the buyer's behalf ($orderRef)."
    line_items       = @(
        @{
            account_id      = $cfpAcc.account_id
            debit_or_credit = 'debit'
            amount          = $handlingCents / 100
            description     = "Delivery margin -- $orderRef"
        },
        @{
            account_id      = $handlingAcc.account_id
            debit_or_credit = 'credit'
            amount          = $handlingCents / 100
            description     = "Delivery margin -- $orderRef"
        }
    )
} | ConvertTo-Json -Depth 6

try {
    $journalResp = Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/journals?organization_id=$orgId" `
        -Headers $jsonHeaders -Body $journalBody
    if (-not $journalResp.journal.journal_id) { throw "Journal creation returned no journal_id" }
    Write-Host "  Journal recorded: $($journalResp.journal.journal_id)" -ForegroundColor Green
} catch {
    Write-Host "  Journal creation FAILED: $($_.Exception.Message)" -ForegroundColor Red
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host "  Journal error body: $($reader.ReadToEnd())" -ForegroundColor Red
    } catch {}
    throw
}

# ─── Bob Go carrier expense ────────────────────────────────────────────
# This Books plan has Bills disabled (code 13036), so the carrier cost is an
# Expense paid through Client Funds Payable (the delivery money we hold).
Write-Host "-> Creating Bob Go carrier expense..." -ForegroundColor Cyan
$expenseBody = @{
    vendor_id               = $vendor.contact_id
    account_id              = $carrierAcc.account_id
    paid_through_account_id = $cfpAcc.account_id
    date                    = $today
    amount                  = $carrierCents / 100
    reference_number        = $orderRef
    description             = "Courier delivery -- $orderRef -- Bob Go carrier rate"
} | ConvertTo-Json -Depth 6

try {
    $expenseResp = Invoke-RestMethod -Method Post -Uri "$apiDomain/books/v3/expenses?organization_id=$orgId" `
        -Headers $jsonHeaders -Body $expenseBody
} catch {
    Write-Host "  Expense payload: $expenseBody" -ForegroundColor DarkGray
    try {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host "  Expense error body: $($reader.ReadToEnd())" -ForegroundColor Red
    } catch {
        Write-Host "  Expense error: $($_.Exception.Message)" -ForegroundColor Red
    }
    throw
}
$expenseId = $expenseResp.expense.expense_id
if (-not $expenseId) { Write-Error "Carrier expense creation failed"; $expenseResp | Format-List; exit 1 }
Write-Host "  Expense created: $expenseId for $(Format-Zar $carrierCents)" -ForegroundColor Green

# ─── Read back + assertions ────────────────────────────────────────────
$invAfter = Get-Invoice $invoiceId
$expenseAfter = Get-Expense $expenseId

$failures = @()
$expectedTotal = ($itemCents + $deliveryCents + $feeCents) / 100
if ([Math]::Abs([double]$invAfter.total - $expectedTotal) -gt 0.001) {
    $failures += "Invoice total $($invAfter.total) != expected $expectedTotal"
}
if ([double]$invAfter.balance -ne 0) {
    $failures += "Invoice balance $($invAfter.balance) != 0 after payment"
}
if ($invAfter.line_items.Count -ne 3) {
    $failures += "Expected 3 invoice lines, got $($invAfter.line_items.Count)"
}
if ($invAfter.line_items[0].account_id -ne $cfpAcc.account_id) {
    $failures += "Item posted to $($invAfter.line_items[0].account_name), not $($cfpAcc.account_name)"
}
if ($invAfter.line_items[1].account_id -ne $cfpAcc.account_id) {
    $failures += "Delivery posted to $($invAfter.line_items[1].account_name), not $($cfpAcc.account_name)"
}
if ($invAfter.line_items[2].account_id -ne $feeAcc.account_id) {
    $failures += "Platform Fee posted to $($invAfter.line_items[2].account_name), not $($feeAcc.account_name)"
}
if ($reference.Length -gt 100) {
    $failures += "Reference is $($reference.Length) chars (Books cap is 100)"
}
if ([Math]::Abs([double]$expenseAfter.total - $carrierCents / 100) -gt 0.001) {
    $failures += "Carrier expense total $($expenseAfter.total) != R145"
}
if ($expenseAfter.vendor_id -ne $vendor.contact_id) {
    $failures += "Carrier expense vendor $($expenseAfter.vendor_id) != Bob Go"
}
if ($expenseAfter.paid_through_account_id -ne $cfpAcc.account_id) {
    $failures += "Carrier expense paid through $($expenseAfter.paid_through_account_name), not $($cfpAcc.account_name)"
}

Write-Host ""
Write-Host "Invoice $invoiceNumber ($invoiceId)" -ForegroundColor White
Write-Host "  Status:  $($invAfter.status)" -ForegroundColor DarkGray
Write-Host "  Total:   $($invAfter.total)" -ForegroundColor DarkGray
Write-Host "  Balance: $($invAfter.balance)" -ForegroundColor DarkGray
foreach ($li in $invAfter.line_items) {
    Write-Host "    - $($li.name): $($li.rate)  [$($li.account_name)]" -ForegroundColor DarkGray
}
Write-Host "Expense $expenseId" -ForegroundColor White
Write-Host "  Vendor:  $($expenseAfter.vendor_name)" -ForegroundColor DarkGray
Write-Host "  Total:   $($expenseAfter.total)" -ForegroundColor DarkGray
Write-Host "  Paid via: $($expenseAfter.paid_through_account_name)" -ForegroundColor DarkGray

Write-Host ""
if ($failures.Count -gt 0) {
    Write-Host "SMOKE TEST FAILED" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 2
}

Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor Green
Write-Host "  SMOKE TEST PASSED" -ForegroundColor Green
Write-Host "─────────────────────────────────────────────────────────" -ForegroundColor Green
Write-Host ""
Write-Host "Created in Books:" -ForegroundColor White
Write-Host "  Contact:        $contactId" -ForegroundColor White
Write-Host "  Buyer invoice:  $invoiceNumber ($invoiceId) -- PAID, $(Format-Zar ($itemCents + $deliveryCents + $feeCents))" -ForegroundColor White
Write-Host "  Buyer payment:  $paymentId -- from $($cfpAcc.account_name)" -ForegroundColor White
Write-Host "  Margin journal: $(Format-Zar $handlingCents) from $($cfpAcc.account_name) -> $($handlingAcc.account_name)" -ForegroundColor White
Write-Host "  Carrier expense: $expenseId -- Bob Go, $(Format-Zar $carrierCents), paid from $($cfpAcc.account_name)" -ForegroundColor White
Write-Host ""
Write-Host "Paper-trail notes:" -ForegroundColor White
Write-Host "  - BUY_NOW has commissionZar = R0, so NO seller commission invoice is raised." -ForegroundColor DarkGray
Write-Host "  - The R1,000 item is in the reference/notes; it is the seller's supply." -ForegroundColor DarkGray
Write-Host "  - Delivery is ONE line to Shipping Charge: carrier R145 + margin R14.50." -ForegroundColor DarkGray
Write-Host "  - Carrier cost is booked separately to $($carrierAcc.account_name)." -ForegroundColor DarkGray
Write-Host ""
Write-Host "Clean up: delete contact 'SMOKETEST -- DELETE ME -- BUYER', invoice $invoiceNumber" -ForegroundColor DarkGray
Write-Host "          and expense $expenseId; keep the Bob Go vendor." -ForegroundColor DarkGray


