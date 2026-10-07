# Sign-in emails

Supabase sends imo's sign-in emails. Paste these templates into the Supabase dashboard:
Authentication → Emails → Templates.

| Template       | Subject                    | Body                  | Sent to                    |
| -------------- | -------------------------- | --------------------- | -------------------------- |
| Confirm signup | `Claim your name on imo`   | `confirm-signup.html` | someone new                |
| Magic link     | `Your imo sign-in link`    | `magic-link.html`     | someone with an account    |

Each email carries a link (web) and a 6-digit code, `{{ .Token }}` (the mobile app, which
verifies it on the device). Keep Authentication → Providers → Email → "Email OTP Length" at 6.

The link goes straight to our callback with a token hash
(`{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`), and the server checks it, so it
opens on any device or browser. `{{ .RedirectTo }}` is our callback with `?next=…`, which must be
on Supabase's Redirect URLs list (Authentication → URL Configuration).

To send from imo's own address instead of "Supabase Auth" (and lift Supabase's limit of a few
emails an hour), turn on custom SMTP under Authentication → Emails → SMTP Settings, e.g. Resend:
host `smtp.resend.com`, port `465`, user `resend`, password = a Resend API key, sender
`hello@tryimo.xyz` (verify the domain in Resend first), sender name `imo`.
