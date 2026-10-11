# Plot X Realty OTP setup

Public users can sign in using either mobile SMS OTP or email OTP.

Set these on the Render backend service (never in frontend JavaScript):

    MSG91_AUTHKEY=...
    MSG91_OTP_TEMPLATE_ID=...
    MSG91_OTP_VAR=VAR1
    RESEND_API_KEY=re_...
    RESEND_FROM_EMAIL=Plot X Realty <login@yourdomain.com>

MSG91: create/approve the SMS OTP template and copy its template ID. The project sends the generated OTP as the template variable `VAR1` by default.

Resend: verify your sending domain and use an address from that domain for `RESEND_FROM_EMAIL`.

After adding the variables, redeploy the backend. API keys are never placed in frontend code.

## Firebase Phone OTP (fast SMS)

The Mobile/SMS OTP path now uses Firebase Phone Authentication directly in the browser, so it does not wait for the Render Flask service to wake up. Email OTP still uses the existing backend provider.

1. Create/open a Firebase project and add a Web App.
2. In Firebase Console -> Authentication -> Sign-in method, enable **Phone**.
3. In Authentication -> Settings -> SMS region policy, allow **India (+91)**.
4. Add your production website domain (for example `plotxrealty.com` and `www.plotxrealty.com`) to **Authorized domains**.
5. Copy the Web App configuration into `firebase-config.js` and replace all `PASTE_...` values.
6. Deploy the ZIP.

Firebase Phone Auth uses reCAPTCHA for abuse prevention; it can be invisible, but Firebase may occasionally show a challenge. The official flow is: send SMS -> enter 6-digit code -> `confirm(code)` -> signed in.
