---
sidebar_position: 8
---

# Resend Email Delivery (previous provider)

:::info Replaced by Brevo
Kickstat now sends email through **[Brevo](brevo)**. Resend is still supported as a **fallback**: the backend uses it only when `BREVO_API_KEY` is not set. The full reasoning for the change is in the [Brevo decision record](brevo#why-we-use-brevo-decision-record).
:::

## What Resend did for us

[Resend](https://resend.com) was Kickstat's transactional email service from Sprint 2. It replaced Gmail SMTP, which could not work in production because Render's free plan blocks outbound SMTP ports. Resend sends over HTTPS instead. It sent:

- **Invite emails** to assistants and players.
- **Event reminder emails** to coaches when a scheduled event was within 24 hours.

We originally chose Resend for its straightforward Node.js SDK and generous free tier.

## Why we moved away from it

On a free Resend account without a **verified domain**, Resend only delivers to the account owner's own email address. Every other recipient is refused:

```text
You can only send testing emails to your own email address (...).
To send emails to other recipients, please verify a domain at resend.com/domains.
```

Our team does not own a domain, and `kickstat.pages.dev` cannot be verified because it belongs to Cloudflare. In practice, invitees never received their invite emails. Brevo can send to anyone from a single verified sender address, without a domain. See the [decision record](brevo#why-we-use-brevo-decision-record).

## Using Resend again

Resend still works in the code (`backend/src/lib/email.js`). To use it:

1. Remove `BREVO_API_KEY` from the environment, so the backend falls back to Resend.
2. Set `RESEND_API_KEY=re_...`.
3. Verify a domain you own in the Resend dashboard (**Domains → Add domain**, then add the DNS records it shows at your registrar).
4. Set `EMAIL_FROM` to an address on that domain, for example `KickStat <reminders@yourdomain.com>`.

Without a verified domain, Resend only reaches the account owner's address, which is enough for local testing only. For local testing, a Gmail `+` alias of your own address (for example `youremail+coach@gmail.com`) also works.

## Compliance / attribution

Resend's brand and trademarks belong to Resend, Inc. We use Resend under its standard terms of service. No Resend code is modified or redistributed.
