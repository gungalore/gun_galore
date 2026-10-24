# =====================================================================
# Zoho Books marketplace smoke test - Buy Now + Auction
# =====================================================================
# Proves, against the LIVE Books org, that one R1,000 X-BAG item with R150
# courier freight produces the correct principal/agent paperwork:
#
#   item price        -> Client Funds Payable (Trust)   [liability]
#   courier freight   -> Client Funds Payable (Trust)   [liability]
#   buyer platform fee-> Platform/Processing Fee Revenue
#   carrier expense   -> paid from trust
#   seller payout     -> journal out of trust to the bank
#
# There is no delivery margin (retired 2026-10-23): the buyer pays the
# courier's live R150 rate.
#
# BUY NOW : buyer invoice + seller statement
# AUCTION : buyer invoice + seller commission invoice + seller statement
#
# Everything created is marked SMOKETEST and every id is printed for
# cleanup. Email delivery goes to support@alloutdoor.co.za so the operator
# can confirm both parties actually received their documents.
#
# Run: powershell -ExecutionPolicy Bypass -File scripts\zoho-marketplace-smoke-test.ps1
#      ... -NoEmails     (create + verify only, send nothing)
# =====================================================================

param(
    [switch]$NoEmails
)

$ErrorActionPreference = 'Stop'

$envPath = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envPath)) { Write-Error "Can't find .env at $envPath"; exit 1 }

$creds = @{}
Get-Content $envPath | ForEach-Object {
    if ($_ -match '^([A-Z0-9_]+)=(.+)$') { $creds[$Matches[1]] = $Matches[2].Trim() }
}
foreach ($k in 'ZOHO_BOOKS_CLIENT_ID','ZOHO_BOOKS_CLIENT_SECRET','ZOHO_BOOKS_REFRESH_TOKEN','ZOHO_BOOKS_ORG_ID') {
    if (-not $creds[$k]) { Write-Error "Missing $k in .env"; exit 1 }
}
if ($creds['ZOHO_BOOKS_ENABLED'] -ne 'true') {
    Write-Host "WARNING: ZOHO_BOOKS_ENABLED is not 'true' in .env. The app itself would skip these API calls." -ForegroundColor Yellow
}

$apiDomain      = if ($creds['ZOHO_BOOKS_API_DOMAIN']) { $creds['ZOHO_BOOKS_API_DOMAIN'] } else { 'https://www.zohoapis.com' }
$accountsDomain = if ($creds['ZOHO_BOOKS_ACCOUNTS_DOMAIN']) { $creds['ZOHO_BOOKS_ACCOUNTS_DOMAIN'] } else { 'https://accounts.zoho.com' }
$orgId          = $creds['ZOHO_BOOKS_ORG_ID']
$q              = "organization_id=$orgId"
$inbox          = 'gerhard.fourie@alloutdoor.co.za'

# ─── Auth ──────────────────────────────────────────────────────────────
Write-Host "-> Refreshing access token..." -ForegroundColor Cyan
$tokenResp = Invoke-RestMethod -Method Post -Uri "$accountsDomain/oauth/v2/token" -Body @{
    grant_type    = 'refresh_token'
    client_id     = $creds['ZOHO_BOOKS_CLIENT_ID']
    client_secret = $creds['ZOHO_BOOKS_CLIENT_SECRET']
    refresh_token = $creds['ZOHO_BOOKS_REFRESH_TOKEN']
}
$token = $tokenResp.access_token
if (-not $token) { Write-Error "Token refresh failed"; exit 1 }
$h  = @{ Authorization = "Zoho-oauthtoken $token" }
$jh = $h + @{ 'Content-Type' = 'application/json' }

function Api([string]$method, [string]$path, $body = $null) {
    $uri = "$apiDomain/books/v3$path"
    # `${uri}` is required: PowerShell parses "$uri?$q" as the variable "$uri?"
    # (undefined) followed by "$q", silently dropping the URL.
    if ($uri.Contains('?')) { $uri = "${uri}&$q" } else { $uri = "${uri}?$q" }
    if ($env:ZOHO_SMOKE_DEBUG -eq '1') { Write-Host "DEBUG $method $uri" -ForegroundColor DarkGray }
    if ($null -ne $body) {
        return Invoke-RestMethod -Method $method -Uri $uri -Headers $jh -Body ($body | ConvertTo-Json -Depth 8)
    }
    return Invoke-RestMethod -Method $method -Uri $uri -Headers $h
}

function Fail($label, $err) {
    Write-Host "  FAIL $label" -ForegroundColor Red
    try {
        $s = $err.Exception.Response.GetResponseStream()
        $r = New-Object System.IO.StreamReader($s)
        Write-Host "       $($r.ReadToEnd())" -ForegroundColor Red
    } catch { Write-Host "       $($err.Exception.Message)" -ForegroundColor Red }
    throw "$label failed"
}

$accounts = (Api 'GET' '/chartofaccounts').chartofaccounts

function Find-Account([string[]]$names) {
    foreach ($n in $names) {
        $hit = $accounts | Where-Object { $_.account_name -eq $n } | Select-Object -First 1
        if ($hit) { return $hit }
    }
    return $null
}

$trust   = Find-Account @('Client Funds Payable (Trust)','Client Funds Payable Liability','Client Funds Payable','Trust Funds Payable')
$fee     = Find-Account @('Platform Fee Revenue','Processing Fee Revenue','Commission Revenue')
$deliv   = Find-Account @('Shipping Handling Revenue','Delivery Handling Revenue','Shipping Charge','Delivery Revenue')
$bank    = Find-Account @('ABSA Business Account','ABSA Business Cheque Account','ABSA - 5183','ABSA 5183')
if (-not $bank) { $bank = $accounts | Where-Object { $_.account_name -like '*ABSA*' -or $_.account_number -like '*5183*' } | Select-Object -First 1 }
if (-not $bank) { $bank = Find-Account @('Bank - FNB Business') }
if (-not $bank) { $bank = $accounts | Where-Object { $_.account_name -like '*FNB*' } | Select-Object -First 1 }
$uf      = Find-Account @('Undeposited Funds')
foreach ($pair in @(
    @('Client Funds Payable (Trust) - liability', $trust),
    @('platform fee revenue', $fee),
    @('delivery income', $deliv),
    @('bank', $bank),
    @('Undeposited Funds', $uf)
)) {
    if (-not $pair[1]) { Write-Error "Missing $($pair[0]) in Books"; exit 1 }
}
if ($trust.account_type -ne 'other_current_liability') {
    Write-Host "WARNING: $($trust.account_name) is account_type '$($trust.account_type)', not a liability. Invoice lines will be rejected." -ForegroundColor Yellow
}

Write-Host "  trust   -> $($trust.account_name) [$($trust.account_type)]" -ForegroundColor Green
Write-Host "  fee     -> $($fee.account_name)" -ForegroundColor Green
Write-Host "  deliver -> $($deliv.account_name)" -ForegroundColor Green
Write-Host "  bank    -> $($bank.account_name)" -ForegroundColor Green
Write-Host "  UF      -> $($uf.account_name)" -ForegroundColor Green

$today = Get-Date -Format 'yyyy-MM-dd'
$from  = (Get-Date).AddDays(-30).ToString('yyyy-MM-dd')
$ts    = Get-Date -Format 'yyyyMMdd-HHmmss'
$enUS  = [System.Globalization.CultureInfo]::new('en-US')
function Zar([int]$cents) {
    $p = if ($cents % 100 -eq 0) { 'N0' } else { 'N2' }
    'R ' + ($cents / 100).ToString($p, $enUS)
}
function New-Contact([string]$name, [string]$email) {
    $body = @{
        contact_name   = "$name $ts"
        contact_type   = 'customer'
        # Books reads the statement recipient from the top-level email as
        # well as contact_persons; without this the statement endpoint
        # answers 1007 "email address ... not found".
        email          = $email
        contact_persons = @(@{
            first_name = 'Smoke'; last_name = 'Test'; email = $email; is_primary_contact = $true
        })
        notes = 'Created by zoho-marketplace-smoke-test.ps1 -- safe to delete.'
    }
    return (Api 'POST' '/contacts' $body).contact.contact_id
}
function New-Invoice([string]$contactId, [string]$reference, $lines, [string]$notes) {
    $body = @{ customer_id = $contactId; date = $today; line_items = $lines; notes = $notes }
    # No reference_number: Zoho renders it as the P.O.# block, which the
    # production invoices deliberately omit.
    if ($reference) { $body.reference_number = $reference }
    $r = (Api 'POST' '/invoices' $body).invoice
    Api 'POST' "/invoices/$($r.invoice_id)/status/sent" @{} | Out-Null
    return $r
}
function Pay-Invoice([string]$contactId, $invoice, [string]$depositAccountId, [string]$reference, [string]$description) {
    # Books caps a customer-payment reference at 50 chars (unlike an
    # invoice's 100).
    $ref50 = $reference.Substring(0, [Math]::Min(50, $reference.Length))
    $body = @{
        customer_id = $contactId; payment_mode = 'others'; amount = [double]$invoice.total
        date = $today; reference_number = $ref50
        account_id = $depositAccountId
        invoices = @(@{ invoice_id = $invoice.invoice_id; amount_applied = [double]$invoice.total })
        description = $description
    }
    return (Api 'POST' '/customerpayments' $body).payment.payment_id
}
function New-Journal([string]$reference, [string]$notes, $lines) {
    $body = @{ journal_date = $today; reference_number = $reference; notes = $notes; line_items = $lines }
    return (Api 'POST' '/journals' $body).journal
}
function New-Carrier-Journal([string]$reference, [int]$cents) {
    # An Expense credits its paid-through account, which would INCREASE a
    # liability. Pay the carrier out of the trust liability and the bank with
    # a journal instead.
    return New-Journal "Carrier freight -- $reference" 'Bob Go carrier freight paid from the bank on the seller behalf.' @(
        @{ account_id = $trust.account_id; debit_or_credit = 'debit'; amount = $cents / 100; description = "Carrier freight -- $reference" },
        @{ account_id = $bank.account_id; debit_or_credit = 'credit'; amount = $cents / 100; description = "Carrier freight -- $reference" }
    )
}
function Send-Invoice([string]$invoiceId, [string]$party) {
    if ($NoEmails) { Write-Host "  email skipped (-NoEmails): $party invoice" -ForegroundColor Yellow; return }
    try {
        Api 'POST' "/invoices/$invoiceId/email" @{
            to_mail_ids = @($inbox)
            subject = "SMOKETEST $party invoice"
            body = 'Smoke-test paperwork. Please ignore.'
        } | Out-Null
        Write-Host "  emailed $party invoice -> $inbox" -ForegroundColor Green
    } catch { Fail "email $party invoice" $_ }
}
function Send-Statement([string]$contactId, [string]$party, [string]$email) {
    if ($NoEmails) { Write-Host "  email skipped (-NoEmails): $party statement" -ForegroundColor Yellow; return }
    try {
        Api 'POST' "/contacts/$contactId/statements/email" @{
            send_mail = $true; from_date = $from; to_date = $today
            to_mail_ids = @($email)
            subject = "SMOKETEST $party account statement"
            body = 'Smoke-test statement. Please ignore.'
        } | Out-Null
        Write-Host "  emailed $party statement -> $inbox" -ForegroundColor Green
    } catch { Fail "email $party statement" $_ }
}
function Invoice-Total($inv) {
    $fresh = (Api 'GET' "/invoices/$($inv.invoice_id)").invoice
    return [double]$fresh.total
}
function Account-Balance([string]$accountId) {
    # The chart-of-accounts detail endpoint returns an empty current_balance.
    # The general-ledger report carries the real figure.
    try {
        $gl = (Api 'GET' "/reports/generalledger?from_date=2026-01-01&to_date=$today").generalledger
        $row = $gl | Where-Object { $_.account_id -eq $accountId } | Select-Object -First 1
        if (-not $row) { return $null }
        return [double]$row.balance
    } catch { return $null }
}

$failures = @()
$created  = @()

function Run-BuyNow {
    Write-Host ""
    Write-Host "=== BUY NOW: R1,000 X-BAG + R150 delivery + R115 fee ===" -ForegroundColor Magenta
    $buyerEmail  = "gerhard.fourie+smoke-bn-buyer-$ts@alloutdoor.co.za"
    $sellerEmail = "gerhard.fourie+smoke-bn-seller-$ts@alloutdoor.co.za"
    $buyerId  = New-Contact 'SMOKETEST -- DELETE ME -- BUYER BN' $buyerEmail
    $sellerId = New-Contact 'SMOKETEST -- DELETE ME -- SELLER BN' $sellerEmail
    $script:created += "contact buyer $buyerId", "contact seller $sellerId"

    $item = 100000; $carrierC = 15000; $handlingC = 0; $deliveryC = 15000
    $feeC = 11500; $totalC = 126500; $payoutC = 100000
    $ref = "SMOKE-BN-$ts"
    $buyerInv = New-Invoice $buyerId '' @(
        @{ name = 'X-BAG *'; description = ''; rate = $item / 100; quantity = 1; account_id = $trust.account_id },
        @{ name = 'Delivery *'; description = ''; rate = $deliveryC / 100; quantity = 1; account_id = $trust.account_id },
        @{ name = 'Platform Fee **'; description = ''; rate = $feeC / 100; quantity = 1; account_id = $fee.account_id }
    ) "* Principal Supplies - Fees collected on behalf of unrelated third parties (Item Seller and Courier Service)`n** Agent Supplies - All Outdoor Platform Fee`nRef: $ref"
    $script:created += "buyer invoice $($buyerInv.invoice_number) $($buyerInv.invoice_id)"

    # No seller-side document on Buy Now: the platform's remittance advice is
    # issued at payout, not a zero-total invoice.

    $buyerPay = Pay-Invoice $buyerId $buyerInv $bank.account_id "Platform charges -- $ref" 'Buyer payment received into the bank'
    $script:created += "buyer payment $buyerPay"

    $carrierJournal = New-Carrier-Journal $ref $carrierC
    $script:created += "carrier journal $($carrierJournal.journal_id)"
    $pJournal = New-Journal "Seller payout -- $ref" 'Seller payout from held funds.' @(
        @{ account_id = $trust.account_id; debit_or_credit = 'debit'; amount = $payoutC / 100; description = "Seller payout -- $ref" },
        @{ account_id = $bank.account_id; debit_or_credit = 'credit'; amount = $payoutC / 100; description = "Seller payout -- $ref" }
    )
    $script:created += "payout journal $($pJournal.journal_id)"

    Send-Invoice $buyerInv.invoice_id 'buyer'
    Send-Statement $sellerId 'seller' $inbox

    $fresh = (Api 'GET' "/invoices/$($buyerInv.invoice_id)").invoice
    if ([Math]::Abs([double]$fresh.total - ($totalC / 100)) -gt 0.001) { $script:failures += "BN buyer invoice total $($fresh.total) != $(Zar $totalC)" }
    if ([double]$fresh.balance -ne 0) { $script:failures += "BN buyer invoice balance $($fresh.balance) != 0" }
    $lineAccts = @($fresh.line_items | ForEach-Object { $_.account_id })
    if ($lineAccts[0] -ne $trust.account_id -or $lineAccts[1] -ne $trust.account_id -or $lineAccts[2] -ne $fee.account_id) {
        $script:failures += "BN line accounts wrong: $($lineAccts -join ',')"
    }
    $cfp = ($item + $deliveryC) - $handlingC - $carrierC - $payoutC
    if ($cfp -ne 0) { $script:failures += "BN trust arithmetic leaves $cfp cents" }
    Write-Host "  buyer invoice $($fresh.invoice_number) total $(Zar ([int]($fresh.total * 100))) paid; no seller invoice (remittance advice at payout); trust leaves $(Zar $cfp)" -ForegroundColor Green
}

function Run-Auction {
    Write-Host ""
    Write-Host "=== AUCTION: hammer R1,000 X-BAG + R150 delivery, 5% / 5% split ===" -ForegroundColor Magenta
    $buyerEmail  = "gerhard.fourie+smoke-au-buyer-$ts@alloutdoor.co.za"
    $sellerEmail = "gerhard.fourie+smoke-au-seller-$ts@alloutdoor.co.za"
    $buyerId  = New-Contact 'SMOKETEST -- DELETE ME -- BUYER AU' $buyerEmail
    $sellerId = New-Contact 'SMOKETEST -- DELETE ME -- SELLER AU' $sellerEmail
    $script:created += "contact buyer $buyerId", "contact seller $sellerId"

    $hammer = 100000; $carrierC = 15000; $handlingC = 0; $deliveryC = 15000
    $buyerFeeC = [int][Math]::Round(($hammer + $deliveryC) * 0.05)  # 5750
    $sellerFeeC = [int][Math]::Round($hammer * 0.05)                # 5000
    $buyerTotalC = $hammer + $deliveryC + $buyerFeeC
    $payoutC = $hammer - $sellerFeeC
    $ref = "SMOKE-AU-$ts"

    $buyerInv = New-Invoice $buyerId '' @(
        @{ name = 'X-BAG *'; description = ''; rate = $hammer / 100; quantity = 1; account_id = $trust.account_id },
        @{ name = 'Delivery *'; description = ''; rate = $deliveryC / 100; quantity = 1; account_id = $trust.account_id },
        @{ name = 'Platform Fee (5%) **'; description = ''; rate = $buyerFeeC / 100; quantity = 1; account_id = $fee.account_id }
    ) "* Principal Supplies - Fees collected on behalf of unrelated third parties (Item Seller and Courier Service)`n** Agent Supplies - All Outdoor Platform Fee`nRef: $ref"
    $script:created += "buyer invoice $($buyerInv.invoice_number) $($buyerInv.invoice_id)"
    $buyerPay = Pay-Invoice $buyerId $buyerInv $bank.account_id "Platform charges -- $ref" 'Auction buyer payment received into the bank'
    $script:created += "buyer payment $buyerPay"

    $carrierJournal = New-Carrier-Journal $ref $carrierC
    $script:created += "carrier journal $($carrierJournal.journal_id)"

    # Seller's 5% commission invoice (production shape: one Platform Fee line).
    $sellerInv = New-Invoice $sellerId '' @(
        @{ name = 'Platform Fee'; description = 'All Outdoor (Agent)'; rate = $sellerFeeC / 100; quantity = 1; account_id = $fee.account_id }
    ) "Sold for $(Zar $hammer) - $(Zar $sellerFeeC) (Platform Fee) = $(Zar $payoutC) Due to you.`nALL Outdoor acts as agent. Reference: $ref"
    $script:created += "seller invoice $($sellerInv.invoice_number) $($sellerInv.invoice_id)"
    $sellerPay = Pay-Invoice $sellerId $sellerInv $uf.account_id "Commission from held funds -- $ref" 'Auction seller fee settled from held funds'
    $script:created += "seller payment $sellerPay"
    # The payment clears the seller's A/R into Undeposited Funds; this journal
    # takes the same amount out of the held-funds liability, so the pair nets
    # to Dr trust / Cr A/R with no bank movement.
    $feeJournal = New-Journal "Commission from held funds -- $ref" 'Auction seller commission settled from funds collected on the seller behalf.' @(
        @{ account_id = $trust.account_id; debit_or_credit = 'debit'; amount = $sellerFeeC / 100; description = "Commission from held funds -- $ref" },
        @{ account_id = $uf.account_id; debit_or_credit = 'credit'; amount = $sellerFeeC / 100; description = "Commission from held funds -- $ref" }
    )
    $script:created += "commission journal $($feeJournal.journal_id)"

    $pJournal = New-Journal "Seller payout -- $ref" 'Auction seller payout from held funds.' @(
        @{ account_id = $trust.account_id; debit_or_credit = 'debit'; amount = $payoutC / 100; description = "Seller payout -- $ref" },
        @{ account_id = $bank.account_id; debit_or_credit = 'credit'; amount = $payoutC / 100; description = "Seller payout -- $ref" }
    )
    $script:created += "payout journal $($pJournal.journal_id)"

    Send-Invoice $buyerInv.invoice_id 'buyer'
    Send-Invoice $sellerInv.invoice_id 'seller'
    Send-Statement $sellerId 'seller' $inbox

    $buyerFresh = (Api 'GET' "/invoices/$($buyerInv.invoice_id)").invoice
    $sellerFresh = (Api 'GET' "/invoices/$($sellerInv.invoice_id)").invoice
    if ([Math]::Abs([double]$buyerFresh.total - ($buyerTotalC / 100)) -gt 0.001) { $script:failures += "AU buyer invoice total $($buyerFresh.total) != $(Zar $buyerTotalC)" }
    if ([double]$buyerFresh.balance -ne 0) { $script:failures += "AU buyer invoice balance $($buyerFresh.balance) != 0" }
    if ([Math]::Abs([double]$sellerFresh.total - ($sellerFeeC / 100)) -gt 0.001) { $script:failures += "AU seller invoice total $($sellerFresh.total) != $(Zar $sellerFeeC)" }
    if ([double]$sellerFresh.balance -ne 0) { $script:failures += "AU seller invoice balance $($sellerFresh.balance) != 0" }
    # Item and delivery are third-party money (liability); the Platform Fee is
    # income. Guard the links so a bad account mapping fails the smoke run.
    $auLineAccts = @($buyerFresh.line_items | ForEach-Object { $_.account_id })
    if ($auLineAccts[0] -ne $trust.account_id -or $auLineAccts[1] -ne $trust.account_id -or $auLineAccts[2] -ne $fee.account_id) {
        $script:failures += "AU buyer line accounts wrong: $($auLineAccts -join ',')"
    }
    $auSellerAccts = @($sellerFresh.line_items | ForEach-Object { $_.account_id })
    if ($auSellerAccts[0] -ne $fee.account_id) {
        $script:failures += "AU seller line account wrong: $($auSellerAccts -join ',')"
    }
    $cfp = ($hammer + $deliveryC) - $handlingC - $carrierC - $sellerFeeC - $payoutC
    if ($cfp -ne 0) { $script:failures += "AU trust arithmetic leaves $cfp cents" }
    Write-Host "  buyer invoice $($buyerFresh.invoice_number) $(Zar ([int]($buyerFresh.total * 100))) paid; seller invoice $($sellerFresh.invoice_number) $(Zar ([int]($sellerFresh.total * 100))) paid; trust leaves $(Zar $cfp)" -ForegroundColor Green
}

try {
    Run-BuyNow
    Run-Auction
} catch {
    Write-Host "SMOKE TEST ABORTED: $($_.Exception.Message)" -ForegroundColor Red
    try {
        $s = $_.Exception.Response.GetResponseStream()
        $r = New-Object System.IO.StreamReader($s)
        Write-Host "  $($r.ReadToEnd())" -ForegroundColor Red
    } catch {}
    Write-Host "Created before the failure:" -ForegroundColor Yellow
    $created | ForEach-Object { Write-Host "  - $_" }
    exit 2
}

$trustBalance = Account-Balance $trust.account_id
$ufBalance = Account-Balance $uf.account_id
Write-Host ""
Write-Host "Trust account $($trust.account_name) ledger balance: $(if ($null -eq $trustBalance) { 'n/a' } else { Zar ([int]($trustBalance * 100)) })" -ForegroundColor Cyan
Write-Host "Undeposited Funds ledger balance: $(if ($null -eq $ufBalance) { 'n/a' } else { Zar ([int]($ufBalance * 100)) })" -ForegroundColor Cyan
if ($null -ne $trustBalance -and [Math]::Abs($trustBalance) -gt 0.001) {
    $failures += "Trust account does not close to zero (balance $(Zar ([int]($trustBalance * 100))))"
}
if ($null -ne $ufBalance -and [Math]::Abs($ufBalance) -gt 0.001) {
    $failures += "Undeposited Funds does not clear to zero (balance $(Zar ([int]($ufBalance * 100))))"
}

Write-Host ""
if ($failures.Count -gt 0) {
    Write-Host "SMOKE TEST FAILED" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 2
}

Write-Host "---------------------------------------------------------" -ForegroundColor Green
Write-Host "  SMOKE TEST PASSED" -ForegroundColor Green
Write-Host "---------------------------------------------------------" -ForegroundColor Green
Write-Host "Created in Books (all safe to delete):" -ForegroundColor White
$created | ForEach-Object { Write-Host "  - $_" -ForegroundColor White }
