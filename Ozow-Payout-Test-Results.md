# Ozow Payout Integration — Test Case Results

- **Merchant:** ALLOUTDOOR (PTY)LTD - Staging (code `ALLOUTDOOR (PTY)LTDStaging`)
- **Site code:** `ALL-ALL-009`
- **Environment:** Ozow staging
- **Standard cases run:** 2026-09-29 (staging hosts)
- **Mock cases run:** 2026-10-04 (mock hosts)
- **Payout notify URL:** `https://alloutdoor.co.za/api/payments/webhook/ozow-payout`
- **Payout verification URL:** `https://alloutdoor.co.za/api/payments/webhook/ozow-payout-verify`

---

## 1. Standard test cases (9)

### 1. Request payout below minimum (< R1.00) — API response

```json
{
    "payoutId": "",
    "payoutStatus": {
        "status": 1,
        "subStatus": 101,
        "errorMessage": "Payout amount below minimum amount"
    }
}
```

### 2. Request payout above maximum (> R20.00) — API response

```json
{
    "payoutId": "",
    "payoutStatus": {
        "status": 1,
        "subStatus": 101,
        "errorMessage": "Payout amount exceeds maximum amount"
    }
}
```

### 3. Receive Verification Request and respond successfully

- Dashboard payout URL: https://stagingdash.ozow.com/MerchantAdmin/Payouts/Details/20260929-2e79-4b91-8627-8d04406b9581
- Payout ID: `20260929-2e79-4b91-8627-8d04406b9581`
- **Verification Success Date: `2026-09-29 13:12:36`**

### 4. Receive Payout Verification Success Message (via notification URL)

- Dashboard payout URL: https://stagingdash.ozow.com/MerchantAdmin/Payouts/Details/20260929-2e79-4b91-8627-8d04406b9581
- "Payout responses" row:
  - Notification Type: **`VerificationSuccessful`**
  - Notify Url: `https://alloutdoor.co.za/api/payments/webhook/ozow-payout`
  - **Notify Success Date: `2026-09-29 13:12:39`** (Created `2026-09-29 13:12:36`, Retry Count 1)

### 5. Receive Payout Complete Message

- Dashboard payout URL: https://stagingdash.ozow.com/MerchantAdmin/Payouts/Details/20260929-2e79-4b91-8627-8d04406b9581
- Status: **Payout Completed** · Payout Completed Date **`2026-09-29 13:12:57`**
- "Payout responses" row:
  - Notification Type: **`PayoutCompleted`**
  - **Notify Success Date: `2026-09-29 13:13:00`** (Created `2026-09-29 13:12:57`, Retry Count 1)

### 6. Receive Payout Cancelled Message

- Dashboard payout URL: https://stagingdash.ozow.com/MerchantAdmin/Payouts/Details/20260929-01cf-4d83-9541-60c1cd255d9d
- Status: **Payout Cancelled**
- "Payout responses" row:
  - Notification Type: **`PayoutCancelled`**
  - Notify Url: `https://alloutdoor.co.za/api/payments/webhook/ozow-payout`
  - **Notify Success Date: `2026-09-29 13:12:41`** (Created `2026-09-29 13:12:39`, Retry Count 1)

### 7. Receive Low Float Balance Message

- Email received: **Yes** — from `noreply@ozow.com`, subject **"TEST Ozow - Float Balance Alert"**, received `2026-09-29` (inbox, not spam).
- Recipient: `gerhard.fourie@alloutdoor.co.za` (Ozow-confirmed configured float alert contact).
- Alert content:

  ```
  Notification
  TEST ENVIRONMENT, PLEASE IGNORE THIS MESSAGE
  Merchant: ALLOUTDOOR (PTY)LTD - Staging
  Alert Balance: 100.00
  Current Balance: -1
  ```

- A fresh valid R1 payout (`20261008-f809-4040-9e6b-c81d93210a0a`) was submitted on `2026-10-08` to re-trigger the alert.

### 8. CDV error — Account number validation error

- Dashboard payout URL: https://stagingdash.ozow.com/MerchantAdmin/Payouts/Details/20260929-01cf-4d83-9541-60c1cd255d9d
- Payout ID: `20260929-01cf-4d83-9541-60c1cd255d9d` · account number used `1234567890`
- Status: **Payout Cancelled**
- Sub Status: **`Payout Cancellation - CDV account number validation failed`**
- Error: `Bank account validation check failed. REASON: The account '1234567890' failed the 'ABSA BANK' CDV - CODE: FailedCDV. Please correct this and try again - The account '1234567890' failed the 'ABSA BANK' CDV`

### 9. Get Payout Status — API response

Final-status payout (`status 5`):

```json
{
    "id": "20260929-2e79-4b91-8627-8d04406b9581",
    "amount": 1,
    "merchantReference": "AOTESTMUMKUJF1",
    "customerBankReference": "AO valid",
    "siteCode": "ALL-ALL-009",
    "isRtc": false,
    "notifyUrl": "https://alloutdoor.co.za/api/payments/webhook/ozow-payout",
    "bankingDetails": {
        "bankGroupId": "3284a0ad-ba78-4838-8c2b-102981286a2b",
        "branchCode": "632005",
        "accountNumber": "pErPo0DH1/ghbroF7Z26Zw=="
    },
    "payoutStatus": {
        "status": 5,
        "subStatus": 0,
        "errorMessage": ""
    }
}
```

- Dashboard payout URL: https://stagingdash.ozow.com/MerchantAdmin/Payouts/Details/20260929-2e79-4b91-8627-8d04406b9581

---

## 2. Mock API test cases (3)

Procedure: `GET getTestConfiguration` → `POST setTestConfiguration` (arm one flag) → `GET getTestConfiguration` (confirm) → `POST /mock/v1/requestpayout` → `GET /mock/v1/getpayout`.

`requestpayout` returned the normal accepted response for all three:
`{"payoutId":"<id>","payoutStatus":{"status":1,"subStatus":201,"errorMessage":""}}`

The forced error then appears on `getpayout`.

### IsAccountDecryptionFailed — mock API response

```json
{
    "id": "20261004-d338-4b61-b26c-7f4df9ba6d71",
    "amount": 1,
    "merchantReference": "AOTESTMUTVNUTQ",
    "customerBankReference": "AO mock-1-decryption",
    "siteCode": "ALL-ALL-009",
    "isRtc": false,
    "notifyUrl": "https://alloutdoor.co.za/api/payments/webhook/ozow-payout",
    "bankingDetails": {
        "bankGroupId": "3284a0ad-ba78-4838-8c2b-102981286a2b",
        "branchCode": "632005",
        "accountNumber": "bztltI9xfxIqJ0W4ntuN/Q=="
    },
    "payoutStatus": {
        "status": 99,
        "subStatus": 205,
        "errorMessage": "Account number decryption failed during verification"
    },
    "identityMatch": {
        "enabled": false,
        "executed": false,
        "result": null,
        "reason": null
    }
}
```

### IsNotVerifiedResponse — mock API response

```json
{
    "id": "20261004-5eb6-49b9-bc88-de826d43e049",
    "amount": 1,
    "merchantReference": "AOTESTMUTVNZ76",
    "customerBankReference": "AO mock-2-not-verifi",
    "siteCode": "ALL-ALL-009",
    "isRtc": false,
    "notifyUrl": "https://alloutdoor.co.za/api/payments/webhook/ozow-payout",
    "bankingDetails": {
        "bankGroupId": "3284a0ad-ba78-4838-8c2b-102981286a2b",
        "branchCode": "632005",
        "accountNumber": "s0G3FVpKWoclCoD6TcNRlQ=="
    },
    "payoutStatus": {
        "status": 99,
        "subStatus": 202,
        "errorMessage": "Is Not Verified Response test"
    },
    "identityMatch": {
        "enabled": false,
        "executed": false,
        "result": null,
        "reason": null
    }
}
```

### IsAccountDecryptionKeyMissing — mock API response

```json
{
    "id": "20261004-db46-4d0d-8f03-1d5bddbff810",
    "amount": 1,
    "merchantReference": "AOTESTMUTVO3P4",
    "customerBankReference": "AO mock-3-key-missin",
    "siteCode": "ALL-ALL-009",
    "isRtc": false,
    "notifyUrl": "https://alloutdoor.co.za/api/payments/webhook/ozow-payout",
    "bankingDetails": {
        "bankGroupId": "3284a0ad-ba78-4838-8c2b-102981286a2b",
        "branchCode": "632005",
        "accountNumber": "TV+NBXAidswUDOPU+Awo6A=="
    },
    "payoutStatus": {
        "status": 99,
        "subStatus": 205,
        "errorMessage": "Is Account Number Decryption Key Missing Response test"
    },
    "identityMatch": {
        "enabled": false,
        "executed": false,
        "result": null,
        "reason": null
    }
}
```

---

## 3. Outstanding items

1. **Case 7 — low float alert.** Resolved: the alert email was received (see case 7). Ozow confirmed the configured contact is `gerhard.fourie@alloutdoor.co.za` with a staging threshold of R100.
2. **Case 3–6 verification/notification** are all confirmed on the dashboard for the 2026-09-29 valid payout; no outstanding action.
