# Plot X Realty

Property listing website with a Flask API, SQLAlchemy database, admin dashboard, and static HTML/CSS/JavaScript frontend.

## Project files

- `app.py` — Flask API and database models
- `index.html`, `style.css`, `script.js` — website UI and admin dashboard
- `auth.js` — Get in Touch account/contact flow (no Firebase client setup)
- `assets/` — site images and branding
- `requirements.txt` — Python dependencies
- `render.yaml` / `Procfile` — backend deployment configuration
- `netlify.toml` — static frontend deployment configuration

## Run the backend locally

1. Use Python 3.11 or newer and create/activate a virtual environment.
2. Install dependencies: `pip install -r requirements.txt`.
3. Copy `.env.example` to `.env` and set real values. Never commit `.env`.
4. Start the API: `python app.py` (or `gunicorn app:app`).

Required backend environment variables: `DATABASE_URL`, a random `SECRET_KEY` of at least 32 characters, and `ADMIN_PASSWORD`. Cloudinary credentials are required for hosted image uploads. The app intentionally refuses to start without the secret key and admin password rather than falling back to public default credentials.

## Deploy

- Deploy the Flask backend to Render using `render.yaml`; configure its environment variables in Render.
- Deploy the static site to Netlify from this project directory. Update the `API_BASE` values in `script.js` and `auth.js` if the backend URL changes.
- Confirm `/health` responds before testing the website.

## Get in Touch account behavior

For browsers without a saved profile, the Get in Touch form appears shortly after page load and must be submitted to create a lightweight contact profile. Contact details are saved to `POST /api/users/contact` and appear in the admin Users list. The profile persists in that browser's local storage until Log out. This is a contact-registration flow, **not verified authentication**: phone ownership is not verified by OTP and the profile must not be used to protect sensitive/private data.

## Before pushing to Git

- Keep `.env`, database URLs/passwords, API secrets, and production credentials out of Git.
- Set a strong unique `SECRET_KEY` and admin password in the deployment provider.
- Do not commit uploaded customer files or local databases.
