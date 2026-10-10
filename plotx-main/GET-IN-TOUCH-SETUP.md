# Plot X Realty — Get in Touch account flow

- Customer Firebase sign-in setup and the old customer sign-in modal are not used by this frontend.
- Visitors without a saved local profile see the mandatory Get in Touch form shortly after page load. It cannot be dismissed without submitting.
- The form asks for a name and valid Indian mobile number; email is optional.
- Submissions are saved through `POST /api/users/contact` into the existing `SiteUser` database table and appear in Admin Dashboard → Users.
- The Account button opens the saved profile; Log out clears the browser's saved profile.
- Profile persistence is limited to the same browser/device and uses `localStorage`.

## Deploy and test

1. Configure the backend environment variables documented in `.env.example` and deploy the Flask API to Render.
2. Deploy the frontend to Netlify. Make sure `API_BASE` in `script.js` and `auth.js` points to the deployed API.
3. Open the site in a browser with no `px_user_profile` in local storage, submit the form, and verify the record appears under Admin Dashboard → Users.

## Identity limitation

This is a lightweight contact/profile flow, not verified authentication. Phone ownership is not checked by OTP, so it must not be used to prove identity or protect private data. Cross-device recovery requires a verified authentication method.
