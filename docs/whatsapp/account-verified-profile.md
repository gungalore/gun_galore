# WhatsApp template — account verified / profile setup

Created in Meta on **2026-11-28** for the ALLOutdoor WhatsApp Business Account.

| Field | Value |
|---|---|
| Template ID | `1651190533368587` |
| Name | `account_verified_profile` |
| Language | `en` |
| Category | **UTILITY** (submitted; Meta's final review can still reclassify) |
| Status | **PENDING** at submission time — not sendable until Meta approves it |
| Header | IMAGE — `account-verified-profile-header.png` in this folder (ALL Outdoor horizontal logo on white, 1125 × 600) |
| Body | `Hi {{1}}, your ALL Outdoor account has been verified. Open alloutdoor.co.za to finish setting up your profile and manage your account.` |
| Body example | `{{1}}` = `Alex` |
| Footer | `ALL Outdoor` |
| Button | URL: `Open ALL Outdoor` → `https://alloutdoor.co.za/` (fully static) |

## Why this should classify as utility

The message is an **account-status update**, not a promotion:

- It is sent after the member verifies their phone number, and says the account has been verified.
- The only action is completing the member's own profile / account.
- No product, price, offer, "buy", "sell", "deal", catalogue or marketing incentive appears.
- The website link is a static URL button to the member's account entry point, not a campaign URL.

It deliberately does **not** use the word “welcome” or promotional verbs. Meta's existing
`welcome_complete_profile` template was classified **MARKETING** because its body invited the member to
“buy, sell and get order updates”; this new copy anchors to the verification event instead. Meta still makes
the final category decision during review — if it reclassifies this as marketing, do not claim utility.

## Reproduce / submit payload

```json
{
  "name": "account_verified_profile",
  "language": "en",
  "category": "UTILITY",
  "components": [
    {
      "type": "HEADER",
      "format": "IMAGE",
      "example": { "header_handle": ["<resumable-upload handle for account-verified-profile-header.png>"] }
    },
    {
      "type": "BODY",
      "text": "Hi {{1}}, your ALL Outdoor account has been verified. Open alloutdoor.co.za to finish setting up your profile and manage your account.",
      "example": { "body_text": [["Alex"]] }
    },
    { "type": "FOOTER", "text": "ALL Outdoor" },
    {
      "type": "BUTTONS",
      "buttons": [
        { "type": "URL", "text": "Open ALL Outdoor", "url": "https://alloutdoor.co.za/" }
      ]
    }
  ]
}
```

The image header needs a **Resumable Upload API** handle, not a phone-number media ID. The logo is deliberately
hosted here for submission; at send time the app must supply the approved template's image-header parameter
(either a public HTTPS logo URL from the site or a fresh Meta media handle). This template is **not wired into
`WHATSAPP_TEMPLATES` yet** — the existing approved `welcome_complete_profile` remains the live welcome send until
this one is approved and the send path supports the image header.
