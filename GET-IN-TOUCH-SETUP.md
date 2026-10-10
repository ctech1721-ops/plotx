# PlotX Realty — Get in Touch account flow

## What changed
- Removed the customer Sign in / Create account modal and Firebase OTP scripts from the frontend.
- Visitors can browse property details without signing in.
- A mandatory Get in Touch popup appears automatically after 2 minutes if no account is saved in that browser. It has no close button and cannot be dismissed by clicking the backdrop or pressing Escape; visitors must submit the form to continue.
- The form asks for name and a valid Indian mobile number; email is optional.
- Submissions are saved through `POST /api/users/contact` into the existing `SiteUser` database table, so they appear in Admin Dashboard → Users.
- The Account button opens the saved account; Log out clears the browser's saved account.
- The account profile is kept in `localStorage`, so it survives closing/reopening the same browser on the same device until Log out.

## Deployment
1. Deploy the updated project to Render so `app.py` includes `/api/users/contact`.
2. Deploy the updated static frontend to Netlify.
3. Test by opening the site in a browser with no saved `px_user_profile`; wait 2 minutes, submit the form, and check Admin Dashboard → Users.

## Important identity note
This is a lightweight contact/account flow, not verified authentication. The phone number is not checked by OTP, so it should not be used to protect private data or prove phone ownership. Browser persistence applies to the same browser/device; cross-device account recovery would require a verified login method.
