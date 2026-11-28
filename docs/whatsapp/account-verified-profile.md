# WhatsApp template — account verified / profile setup

Created in Meta on **2026-11-28** for the ALLOutdoor WhatsApp Business Account.

| Field | Value |
|---|---|
| Template ID | `1651190533368587` |
| Name | `account_verified_profile` |
| Language | `en` |
| Category | **UTILITY** (Meta approved as UTILITY on 2026-11-28) |
| Status | **APPROVED** |
| Header | IMAGE — `account-verified-profile-header.png` in this folder (ALL Outdoor horizontal logo on white, 1125 × 600); public send URL `https://alloutdoor.co.za/brand/account-verified-profile-header.png` |
| Body | `Hi {{1}}, your ALL Outdoor account has been verified. Open alloutdoor.co.za to finish setting up your profile and manage your account.` |
| Body example | `{{1}}` = `Alex` (the app sends the member's public `username`) |
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

The image header needs a **Resumable Upload API** handle for submission; at send time the app supplies the
approved template's image-header parameter via the public HTTPS logo URL above. The app is wired to this
template: `WHATSAPP_TEMPLATES.account_verified_profile` carries `headerImageUrl`, and
`welcomeWhatsapp` sends it after phone verification with the member's public username. The old
`welcome_complete_profile` (MARKETING) remains in the registry only as a historical/log reference and is no
longer sent.
