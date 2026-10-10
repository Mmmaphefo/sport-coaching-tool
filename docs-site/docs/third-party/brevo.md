---
sidebar_position: 4
---

# Brevo Email Delivery

## What Brevo does for us

[Brevo](https://www.brevo.com) is Kickstat's transactional email service. It sends:

- **Invite emails** when a coach invites an assistant coach or a player. Each email contains a link to join the squad, and for players whose account the backend creates, their first sign-in details.
- **Event reminder emails** to coaches when a scheduled event starts within the next 24 hours (the hourly reminder sweep).

Emails are sent over Brevo's HTTPS API (`POST https://api.brevo.com/v3/smtp/email`), not over SMTP.

## Why we use Brevo: decision record

Email delivery has changed twice during the project. Each change was forced by a limit of the service we were using at the time.

| Stage | Provider | Why it was replaced |
|---|---|---|
| 1 | Gmail SMTP (`nodemailer`) | Render's free plan blocks outbound SMTP ports (25, 465, 587), so emails could not leave the server in production. |
| 2 | [Resend](resend) (HTTP API) | Fixed the blocked ports, but Resend only sends to people other than the account owner from a **domain you own** and have verified. Our team does not own a domain, and `kickstat.pages.dev` belongs to Cloudflare, so it cannot be verified. |
| 3 | **Brevo** (HTTP API) | Current provider. See below. |

### The problem with Resend

On a Resend account without a verified domain, Resend runs in **test mode**: it delivers only to the email address of the Resend account owner. Every other recipient is refused with:

```text
You can only send testing emails to your own email address (...).
To send emails to other recipients, please verify a domain at resend.com/domains.
```

In practice this meant **invited assistants and players never received their invite email**. The app fell back to showing the coach a link to share by hand, so invites still worked, but the email feature did not.

It also exposed a privacy problem: the dashboard displayed Resend's raw error message to every coach who sent an invite, and that message contained the **Resend account owner's personal email address**. That was fixed separately (see [Error messages shown to users](#error-messages-shown-to-users)).

### Options we considered

| Option | Reaches any recipient? | Needs a domain? | Cost | Outcome |
|---|---|---|---|---|
| Keep Resend, verify a domain | Yes | Yes (buy one and set up DNS records) | Domain cost; DNS changes can take a while to apply | Not possible in time: no team-owned domain |
| Go back to Gmail SMTP | Yes | No | Free | Not possible: Render blocks SMTP ports |
| **Brevo with a single verified sender** | **Yes** | **No** | **Free** (up to 300 emails a day) | **Chosen** |

Brevo's free plan allows sending to any recipient once **one sender address** has been verified by clicking a confirmation link. No domain or DNS changes are needed. It also uses an HTTPS API, so Render's SMTP block does not affect it.

### Trade-offs we accepted

- **Inbox placement is not guaranteed.** Our sender is a free Gmail address (`kickstat.team@gmail.com`), sent through Brevo's servers. Receiving mail providers trust this less than mail from an authenticated domain, because the DKIM and DMARC checks cannot be aligned with `gmail.com`. Brevo's dashboard flags this as "Freemail domain is not recommended". In testing, invites were delivered, but Gmail filed them under the **Promotions** tab. Some providers may place them in spam.
- **The share link stays as a fallback.** After sending an invite, the dashboard still shows the invite link, so a coach can share it another way if an email goes missing.
- **The long-term fix is a domain.** For a production release, the team should buy a domain, authenticate it in Brevo (or Resend), and send from an address on it. No code change is needed for that: only the `EMAIL_FROM` value changes.

## How provider selection works

Both providers are supported, and the backend picks one at send time from its environment (`backend/src/lib/email.js`):

1. If `BREVO_API_KEY` is set, all email goes through **Brevo**.
2. Otherwise, if `RESEND_API_KEY` is set, email goes through **Resend** (the previous behaviour).
3. If neither is set, sending is skipped and a log line explains why. This keeps local development and CI working without real email.

Invites (`backend/src/routes/invites.js`) and reminders (`backend/src/lib/reminders.js`) both send through the shared `sendEmail()` function, so they always use the same provider. `sendEmail()` never throws: it returns `{ sent: true }` or `{ sent: false, error }`.

- A **reminder** that fails to send is **not** marked as sent, so the next hourly sweep retries it.
- An **invite** that fails to send is still created, and the coach is shown the share link.

## Required environment variables

Set these on Render (**kickstat-api → Environment**) or in `backend/.env` locally:

```bash
BREVO_API_KEY=xkeysib-...
EMAIL_FROM=KickStat <kickstat.team@gmail.com>
```

- `BREVO_API_KEY`: created in Brevo under **SMTP & API → API Keys**. Brevo only shows a key once, when it is created. Keep it secret and never commit it.
- `EMAIL_FROM`: must match a **verified sender** in Brevo (**Settings → Senders, domains, IPs → Senders**) exactly. Both `Name <address>` and a bare address are accepted.

`RESEND_API_KEY` can stay set. It is ignored while `BREVO_API_KEY` is present.

## Setting up Brevo

1. Create a free account at brevo.com. Use the team address rather than a personal one, because the sender address is visible to every recipient.
2. When asked for a website, enter `https://kickstat.pages.dev`. When asked what you will send, choose **transactional** email.
3. Go to **Settings → Senders, domains, IPs → Senders**, add the team address, and click the confirmation link Brevo emails to it. Wait until it shows **Verified**.
4. Go to **SMTP & API → API Keys**, generate a key, and copy it.
5. Leave **IP address blocking for API keys** turned off. Render's free tier has no fixed outbound IP address, so allow-listing would block the backend.
6. Add both environment variables on Render and redeploy.
7. Send a test invite to an address that is **not** the sender's, and check the recipient's Inbox, Promotions and Spam folders.

## Error messages shown to users

The provider's raw error message is written to the **server log only**. The browser receives a short, plain explanation from `publicEmailError()` in `email.js`:

| Situation | Message shown to the coach |
|---|---|
| No provider configured | "Email sending is not set up on the server yet." |
| Sender or domain not verified | "Email can only be sent to outside addresses once a sending domain is set up." |
| Any other failure | "The email service could not send this invite right now." |

This prevents leaking details such as account email addresses or provider configuration, which previously happened with Resend's test-mode error.

## Troubleshooting

To see the provider's exact error, check **Render → Logs** for a line starting `Invite email to … was not sent:`. To follow a specific email, use Brevo's transactional logs, which show statuses such as delivered, deferred, blocked and bounced.

| Symptom | Likely cause |
|---|---|
| Dashboard says "sent", but nothing arrives | Check Promotions and Spam. Then check Brevo's logs for a deferred, blocked or bounced status. |
| Brevo log shows **blocked** | A new Brevo account may need activating before it sends. Look for a notice in the Brevo dashboard or the team inbox. |
| Error about the sender not being valid | `EMAIL_FROM` does not exactly match a verified Brevo sender. |
| Error about an unrecognised IP address | Brevo's IP blocking is on. Turn it off under **Settings → Security → Authorized IPs**. |

## Tests

`backend/tests/unit/email-and-reminders.unit.test.js` tests Brevo with a fake API, so no real email is sent. It covers the request format, sender parsing, rejections, network failures and timeouts, a missing `EMAIL_FROM`, reminders being retried after a failure, and the safe user-facing messages. `backend/tests/integration/email.test.js` covers the Resend path.

## Compliance / attribution

Brevo's brand and trademarks belong to Brevo (formerly Sendinblue). We use Brevo's free plan under its standard terms of service, through its public HTTP API. No Brevo code is modified or redistributed.
