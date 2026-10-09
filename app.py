import os
import re
import uuid
import secrets
import datetime
import logging
import requests
import jwt

from functools import wraps

from flask import Flask, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

import cloudinary
import cloudinary.uploader

try:
    from flask_compress import Compress
except ImportError:
    Compress = None


# =========================================================
# BASE DIRECTORY
# =========================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# =========================================================
# FLASK APP
# =========================================================

app = Flask(
    __name__,
    static_folder=BASE_DIR,
    static_url_path=""
)


# =========================================================
# CONFIG
# =========================================================

SECRET_KEY = os.environ.get("SECRET_KEY")

if not SECRET_KEY or len(SECRET_KEY) < 32:
    raise RuntimeError(
        "SECRET_KEY must be set to a strong secret in production"
    )

app.config["SECRET_KEY"] = SECRET_KEY

app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

app.config["UPLOAD_FOLDER"] = os.path.join(
    BASE_DIR,
    "uploads"
)

os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)


# =========================================================
# CORS
# =========================================================

CORS(
    app,
    resources={
        r"/api/*": {
            "origins": "*"
        }
    }
)


# =========================================================
# COMPRESSION
# =========================================================

if Compress:
    Compress(app)


# =========================================================
# DATABASE
# =========================================================

database_url = os.environ.get("DATABASE_URL")

if not database_url:
    raise RuntimeError("DATABASE_URL environment variable is required")

if database_url.startswith("postgres://"):
    database_url = database_url.replace(
        "postgres://",
        "postgresql://",
        1
    )

app.config["SQLALCHEMY_DATABASE_URI"] = database_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)


# =========================================================
# CLOUDINARY
# =========================================================

cloudinary.config(
    cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
    api_key=os.environ.get("CLOUDINARY_API_KEY"),
    api_secret=os.environ.get("CLOUDINARY_API_SECRET"),
    secure=True
)


# =========================================================
# MODELS
# =========================================================

class Admin(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(
        db.DateTime,
        default=datetime.datetime.utcnow
    )


class Poster(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    image_url = db.Column(db.Text, nullable=False)
    public_id = db.Column(db.String(255), nullable=True)
    created_at = db.Column(
        db.DateTime,
        default=datetime.datetime.utcnow
    )

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "image_url": self.image_url,
            "public_id": self.public_id,
            "created_at": self.created_at.isoformat()
            if self.created_at else None
        }


class SiteSetting(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "key": self.key,
            "value": self.value
        }


class Lead(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    name = db.Column(db.String(255), nullable=True)
    phone = db.Column(db.String(50), nullable=True)
    email = db.Column(db.String(255), nullable=True)
    message = db.Column(db.Text, nullable=True)

    created_at = db.Column(
        db.DateTime,
        default=datetime.datetime.utcnow
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "phone": self.phone,
            "email": self.email,
            "message": self.message,
            "created_at": self.created_at.isoformat()
            if self.created_at else None
        }


class OtpCode(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    phone = db.Column(db.String(50), nullable=True)
    email = db.Column(db.String(255), nullable=True)

    code = db.Column(db.String(10), nullable=False)

    expires_at = db.Column(
        db.DateTime,
        nullable=False
    )

    verified = db.Column(
        db.Boolean,
        default=False
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.datetime.utcnow
    )


class SiteUser(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    name = db.Column(db.String(255), nullable=True)

    phone = db.Column(
        db.String(50),
        unique=True,
        nullable=True
    )

    email = db.Column(
        db.String(255),
        unique=True,
        nullable=True
    )

    password_hash = db.Column(
        db.String(255),
        nullable=True
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.datetime.utcnow
    )

    def to_public(self):
        return {
            "id": self.id,
            "name": self.name,
            "phone": self.phone,
            "email": self.email,
            "created": self.created_at.isoformat() if self.created_at else None
        }

    def to_admin(self):
        return {
            "id": self.id,
            "name": self.name,
            "phone": self.phone,
            "email": self.email,
            "created": self.created_at.isoformat() if self.created_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


# =========================================================
# HELPERS
# =========================================================

def clean_phone(phone):
    if not phone:
        return ""

    phone = str(phone).strip()

    phone = re.sub(r"[^\d+]", "", phone)

    if phone.startswith("0"):
        phone = "+91" + phone[1:]

    elif phone.startswith("91") and not phone.startswith("+"):
        phone = "+" + phone

    return phone


def valid_email(email):
    if not email:
        return False

    return bool(
        re.match(
            r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
            email
        )
    )


def generate_otp():
    return str(
        secrets.randbelow(900000) + 100000
    )


def _user_token(user):
    payload = {
        "user_id": user.id,
        "type": "user",
        "exp": datetime.datetime.utcnow()
        + datetime.timedelta(days=30)
    }

    return jwt.encode(
        payload,
        app.config["SECRET_KEY"],
        algorithm="HS256"
    )


def _send_otp(phone=None, email=None, code=None):

    if not code:
        code = generate_otp()

    # -----------------------------------------------------
    # SMS - MSG91
    # -----------------------------------------------------

    if phone:

        msg91_authkey = os.environ.get(
            "MSG91_AUTHKEY"
        )

        msg91_template_id = os.environ.get(
            "MSG91_TEMPLATE_ID"
        )

        if msg91_authkey and msg91_template_id:

            try:
                url = "https://control.msg91.com/api/v5/flow"

                payload = {
                    "template_id": msg91_template_id,
                    "short_url": "0",
                    "recipients": [
                        {
                            "mobiles": phone.replace(
                                "+",
                                ""
                            ),
                            "OTP": code
                        }
                    ]
                }

                headers = {
                    "authkey": msg91_authkey,
                    "Content-Type": "application/json"
                }

                response = requests.post(
                    url,
                    json=payload,
                    headers=headers,
                    timeout=15
                )

                if response.ok:
                    return True

                print(
                    "MSG91 ERROR:",
                    response.status_code,
                    response.text
                )

            except Exception as e:
                print(
                    "MSG91 EXCEPTION:",
                    e
                )

        # Development fallback
        print(
            f"[OTP DEBUG] Phone: {phone} | OTP: {code}"
        )

        return True

    # -----------------------------------------------------
    # EMAIL - RESEND
    # -----------------------------------------------------

    if email:

        resend_api_key = os.environ.get(
            "RESEND_API_KEY"
        )

        resend_from = os.environ.get(
            "RESEND_FROM",
            "PlotX <onboarding@resend.dev>"
        )

        if resend_api_key:

            try:
                url = "https://api.resend.com/emails"

                payload = {
                    "from": resend_from,
                    "to": [email],
                    "subject": "PlotX Login OTP",
                    "html": f"""
                    <div style="font-family:Arial,sans-serif">
                        <h2>PlotX Realty</h2>
                        <p>Your login OTP is:</p>
                        <h1>{code}</h1>
                        <p>This OTP will expire in 10 minutes.</p>
                    </div>
                    """
                }

                headers = {
                    "Authorization": f"Bearer {resend_api_key}",
                    "Content-Type": "application/json"
                }

                response = requests.post(
                    url,
                    json=payload,
                    headers=headers,
                    timeout=15
                )

                if response.ok:
                    return True

                print(
                    "RESEND ERROR:",
                    response.status_code,
                    response.text
                )

            except Exception as e:
                print(
                    "RESEND EXCEPTION:",
                    e
                )

        print(
            f"[OTP DEBUG] Email: {email} | OTP: {code}"
        )

        return True

    return False


# =========================================================
# ADMIN AUTH
# =========================================================

def token_required(func):

    @wraps(func)
    def decorated(*args, **kwargs):

        auth_header = request.headers.get("Authorization")

        if not auth_header:
            return jsonify({
                "error": "Authorization required"
            }), 401

        try:
            parts = auth_header.split()

            if len(parts) != 2 or parts[0].lower() != "bearer":
                raise ValueError("Invalid Authorization header format")

            token = parts[1]

            payload = jwt.decode(
                token,
                app.config["SECRET_KEY"],
                algorithms=["HS256"]
            )

            admin_id = payload.get("admin_id")

            if not admin_id:
                raise ValueError("Invalid admin token: admin_id missing")

            admin = db.session.get(Admin, admin_id)

            if admin is None:
                raise ValueError("Admin not found")

            return func(admin, *args, **kwargs)

        except Exception:
            app.logger.exception(
                "Admin token validation failed"
            )
            return jsonify({
                "error": "Invalid or expired token"
            }), 401

    return decorated



# =========================================================
# USER AUTH
# =========================================================

def user_token_required(func):

    @wraps(func)
    def decorated(*args, **kwargs):

        auth_header = request.headers.get("Authorization")

        if not auth_header:
            return jsonify({
                "error": "Authorization required"
            }), 401

        try:
            parts = auth_header.split()

            if len(parts) != 2 or parts[0].lower() != "bearer":
                raise ValueError("Invalid Authorization header")

            token = parts[1]

            payload = jwt.decode(
                token,
                app.config["SECRET_KEY"],
                algorithms=["HS256"]
            )

            if payload.get("type") != "user":
                raise ValueError("Invalid user token")

            user_id = payload.get("user_id")

            if not user_id:
                raise ValueError("User ID missing")

            user = db.session.get(User, user_id)

            if user is None:
                raise ValueError("User not found")

            return func(user, *args, **kwargs)

        except Exception:
            app.logger.exception("User token validation failed")
            return jsonify({
                "error": "Invalid or expired token"
            }), 401

    return decorated





# =========================================================
# FRONTEND
# =========================================================

@app.route("/")
def home():
    return send_from_directory(
        BASE_DIR,
        "index.html"
    )


# =========================================================
# STATIC FILES
# =========================================================

@app.route("/<path:filename>")
def frontend_static(filename):

    # Never allow this route to handle API URLs
    if filename.startswith("api/"):
        return jsonify({
            "error": "Not found"
        }), 404

    full_path = os.path.join(
        BASE_DIR,
        filename
    )

    base_real = os.path.realpath(BASE_DIR)
    file_real = os.path.realpath(full_path)

    if not file_real.startswith(
        base_real + os.sep
    ):
        return jsonify({
            "error": "Not found"
        }), 404

    if os.path.isfile(file_real):

        return send_from_directory(
            BASE_DIR,
            filename
        )

    return jsonify({
        "error": "Not found"
    }), 404


# =========================================================
# PUBLIC API - POSTERS
# =========================================================

@app.route(
    "/api/posters",
    methods=["GET"]
)
def get_posters():

    posters = Poster.query.order_by(
        Poster.created_at.desc()
    ).all()

    return jsonify([
        poster.to_dict()
        for poster in posters
    ])


# =========================================================
# PUBLIC API - SETTINGS
# =========================================================

@app.route(
    "/api/settings",
    methods=["GET"]
)
def get_settings():

    settings = SiteSetting.query.all()

    return jsonify({
        setting.key: setting.value
        for setting in settings
    })


# =========================================================
# PUBLIC API - LEADS
# =========================================================

@app.route(
    "/api/leads",
    methods=["POST"]
)
def create_lead():

    data = request.get_json(
        silent=True
    ) or {}

    lead = Lead(
        name=data.get("name"),
        phone=data.get("phone"),
        email=data.get("email"),
        message=data.get("message")
    )

    db.session.add(lead)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Lead submitted successfully",
        "lead": lead.to_dict()
    }), 201


# =========================================================
# HEALTH
# =========================================================

@app.route(
    "/api/health",
    methods=["GET"]
)
def api_health():

    return jsonify({
        "success": True,
        "status": "ok"
    })


@app.route(
    "/health",
    methods=["GET"]
)
def health():

    return jsonify({
        "success": True,
        "status": "ok"
    })


# =========================================================
# USER OTP REQUEST
# =========================================================

@app.route(
    "/api/users/otp/request",
    methods=["POST"]
)
def request_user_otp():

    data = request.get_json(
        silent=True
    ) or {}

    phone = clean_phone(
        data.get("phone")
    )

    email = (
        str(data.get("email")).strip().lower()
        if data.get("email")
        else ""
    )

    if not phone and not email:

        return jsonify({
            "error": "Phone or email is required"
        }), 400

    if email and not valid_email(email):

        return jsonify({
            "error": "Invalid email address"
        }), 400

    code = generate_otp()

    otp = OtpCode(
        phone=phone or None,
        email=email or None,
        code=code,
        expires_at=datetime.datetime.utcnow()
        + datetime.timedelta(minutes=10)
    )

    db.session.add(otp)
    db.session.commit()

    sent = _send_otp(
        phone=phone or None,
        email=email or None,
        code=code
    )

    if not sent:

        return jsonify({
            "error": "Unable to send OTP"
        }), 500

    return jsonify({
        "success": True,
        "message": "OTP sent successfully"
    })


# =========================================================
# USER OTP VERIFY
# =========================================================

@app.route(
    "/api/users/otp/verify",
    methods=["POST"]
)
def verify_user_otp():

    data = request.get_json(
        silent=True
    ) or {}

    phone = clean_phone(
        data.get("phone")
    )

    email = (
        str(data.get("email")).strip().lower()
        if data.get("email")
        else ""
    )

    code = str(
        data.get("code") or ""
    ).strip()

    if not code:

        return jsonify({
            "error": "OTP is required"
        }), 400

    query = OtpCode.query.filter_by(
        code=code,
        verified=False
    )

    if phone:
        query = query.filter_by(
            phone=phone
        )

    elif email:
        query = query.filter_by(
            email=email
        )

    else:
        return jsonify({
            "error": "Phone or email is required"
        }), 400

    otp = query.order_by(
        OtpCode.created_at.desc()
    ).first()

    if not otp:

        return jsonify({
            "error": "Invalid OTP"
        }), 400

    if otp.expires_at < datetime.datetime.utcnow():

        return jsonify({
            "error": "OTP expired"
        }), 400

    otp.verified = True

    db.session.commit()

    user = None

    if phone:
        user = SiteUser.query.filter_by(
            phone=phone
        ).first()

    if email and not user:
        user = SiteUser.query.filter_by(
            email=email
        ).first()

    # Automatically create user
    if not user:

        user = SiteUser(
            phone=phone or None,
            email=email or None
        )

        db.session.add(user)
        db.session.commit()

    token = _user_token(user)

    return jsonify({
        "success": True,
        "token": token,
        "user": user.to_public()
    })


# =========================================================
# GET IN TOUCH — CREATE / RESTORE A LIGHTWEIGHT WEBSITE ACCOUNT
# =========================================================

@app.route("/api/users/contact", methods=["POST"])
def create_contact_account():
    data = request.get_json(silent=True) or {}

    name = str(data.get("name") or "").strip()
    raw_phone = str(data.get("phone") or "").strip()
    digits = re.sub(r"\D", "", raw_phone)
    email = str(data.get("email") or "").strip().lower()

    if not name:
        return jsonify({"error": "Please enter your name."}), 400
    if len(name) > 255:
        return jsonify({"error": "Name is too long."}), 400
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) != 10 or digits[0] not in "6789":
        return jsonify({"error": "Enter a valid 10-digit Indian mobile number."}), 400
    if email and (len(email) > 255 or not valid_email(email)):
        return jsonify({"error": "Enter a valid email address or leave it blank."}), 400

    # Store the mobile as ten digits so it remains compatible with existing rows.
    user = SiteUser.query.filter(
        (SiteUser.phone == digits) |
        (SiteUser.phone == "+91" + digits) |
        (SiteUser.phone == "0" + digits)
    ).first()

    if email:
        email_owner = SiteUser.query.filter(db.func.lower(SiteUser.email) == email).first()
        if email_owner and user and email_owner.id != user.id:
            return jsonify({"error": "That email is already linked to another account. Please use another email."}), 409
        if email_owner and not user and email_owner.phone:
            return jsonify({"error": "That email is already linked to another account. Please use the registered mobile number."}), 409
        if email_owner and not user:
            user = email_owner

    if not user:
        user = SiteUser(name=name, phone=digits, email=email or None)
        db.session.add(user)
    else:
        user.name = name
        if not user.phone:
            user.phone = digits
        if email:
            user.email = email

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        app.logger.exception("Get in Touch account save failed")
        return jsonify({"error": "We could not save your details right now. Please try again."}), 500

    return jsonify({
        "success": True,
        "token": _user_token(user),
        "user": user.to_public()
    }), 200


# =========================================================
# USER REGISTER
# =========================================================

@app.route(
    "/api/users/register",
    methods=["POST"]
)
def register_user():

    data = request.get_json(
        silent=True
    ) or {}

    name = str(
        data.get("name") or ""
    ).strip()

    phone = clean_phone(
        data.get("phone")
    )

    email = (
        str(data.get("email")).strip().lower()
        if data.get("email")
        else ""
    )

    password = str(
        data.get("password") or ""
    )

    if not name:

        return jsonify({
            "error": "Name is required"
        }), 400

    if not phone and not email:

        return jsonify({
            "error": "Phone or email is required"
        }), 400

    if email and not valid_email(email):

        return jsonify({
            "error": "Invalid email"
        }), 400

    if password and len(password) < 6:

        return jsonify({
            "error": "Password must be at least 6 characters"
        }), 400

    if phone:

        existing = SiteUser.query.filter_by(
            phone=phone
        ).first()

        if existing:

            return jsonify({
                "error": "Phone already registered"
            }), 409

    if email:

        existing = SiteUser.query.filter_by(
            email=email
        ).first()

        if existing:

            return jsonify({
                "error": "Email already registered"
            }), 409

    user = SiteUser(
        name=name,
        phone=phone or None,
        email=email or None,
        password_hash=(
            generate_password_hash(password)
            if password
            else None
        )
    )

    db.session.add(user)
    db.session.commit()

    token = _user_token(user)

    return jsonify({
        "success": True,
        "token": token,
        "user": user.to_public()
    }), 201


# =========================================================
# USER LOGIN
# =========================================================

@app.route(
    "/api/users/login",
    methods=["POST"]
)
def login_user():

    data = request.get_json(
        silent=True
    ) or {}

    identifier = str(
        data.get("identifier")
        or data.get("phone")
        or data.get("email")
        or ""
    ).strip()

    password = str(
        data.get("password") or ""
    )

    phone = clean_phone(
        identifier
    )

    user = None

    if phone.startswith("+"):

        user = SiteUser.query.filter_by(
            phone=phone
        ).first()

    if not user and valid_email(identifier):

        user = SiteUser.query.filter_by(
            email=identifier.lower()
        ).first()

    if not user:

        return jsonify({
            "error": "Invalid login details"
        }), 401

    if not user.password_hash:

        return jsonify({
            "error": "Please login using OTP"
        }), 400

    if not check_password_hash(
        user.password_hash,
        password
    ):

        return jsonify({
            "error": "Invalid login details"
        }), 401

    token = _user_token(user)

    return jsonify({
        "success": True,
        "token": token,
        "user": user.to_public()
    })


# =========================================================
# CURRENT USER
# =========================================================

@app.route(
    "/api/users/me",
    methods=["GET"]
)
@user_token_required
def current_user(user):

    return jsonify({
        "success": True,
        "user": user.to_public()
    })


# =========================================================
# ADMIN LOGIN
# =========================================================

@app.route(
    "/api/admin/login",
    methods=["POST"]
)
def admin_login():

    data = request.get_json(
        silent=True
    ) or {}

    username = str(
        data.get("username") or ""
    ).strip()

    password = str(
        data.get("password") or ""
    )

    admin = Admin.query.filter_by(
        username=username
    ).first()

    if not admin:

        return jsonify({
            "error": "Invalid username or password"
        }), 401

    if not check_password_hash(
        admin.password_hash,
        password
    ):

        return jsonify({
            "error": "Invalid username or password"
        }), 401

    payload = {
        "admin_id": admin.id,
        "exp": datetime.datetime.utcnow()
        + datetime.timedelta(days=7)
    }

    token = jwt.encode(
        payload,
        app.config["SECRET_KEY"],
        algorithm="HS256"
    )

    return jsonify({
        "success": True,
        "token": token,
        "admin": {
            "id": admin.id,
            "username": admin.username
        }
    })


# =========================================================
# ADMIN - UPLOADS
# =========================================================

@app.route(
    "/uploads/<path:filename>"
)
def uploaded_file(filename):

    return send_from_directory(
        app.config["UPLOAD_FOLDER"],
        filename
    )


# =========================================================
# ADMIN - POSTERS
# =========================================================

@app.route(
    "/api/admin/posters",
    methods=["POST"]
)
@token_required
def admin_create_poster(admin):

    title = request.form.get(
        "title",
        ""
    ).strip()

    image = request.files.get(
        "image"
    )

    if not image:

        return jsonify({
            "error": "Image is required"
        }), 400

    if not title:

        title = "PlotX Property"

    try:

        result = cloudinary.uploader.upload(
            image,
            folder="plotx/posters"
        )

        poster = Poster(
            title=title,
            image_url=result.get("secure_url"),
            public_id=result.get("public_id")
        )

        db.session.add(poster)
        db.session.commit()

        return jsonify({
            "success": True,
            "poster": poster.to_dict()
        }), 201

    except Exception as e:

        print(
            "CLOUDINARY ERROR:",
            e
        )

        return jsonify({
            "error": "Image upload failed"
        }), 500


# =========================================================
# ADMIN - DELETE POSTER
# =========================================================

@app.route(
    "/api/admin/posters/<int:poster_id>",
    methods=["DELETE"]
)
@token_required
def admin_delete_poster(
    admin,
    poster_id
):

    poster = db.session.get(
        Poster,
        poster_id
    )

    if not poster:

        return jsonify({
            "error": "Poster not found"
        }), 404

    if poster.public_id:

        try:

            cloudinary.uploader.destroy(
                poster.public_id
            )

        except Exception as e:

            print(
                "CLOUDINARY DELETE ERROR:",
                e
            )

    db.session.delete(poster)
    db.session.commit()

    return jsonify({
        "success": True
    })


# =========================================================
# ADMIN - LEADS
# =========================================================

@app.route(
    "/api/admin/leads",
    methods=["GET"]
)
@token_required
def admin_leads(admin):

    leads = Lead.query.order_by(
        Lead.created_at.desc()
    ).all()

    return jsonify([
        lead.to_dict()
        for lead in leads
    ])


# =========================================================
# ADMIN - USERS
# =========================================================

@app.route(
    "/api/admin/users",
    methods=["GET"]
)
@token_required
def admin_users(admin):

    users = SiteUser.query.order_by(
        SiteUser.created_at.desc()
    ).all()

    return jsonify([
        user.to_admin()
        for user in users
    ])


# =========================================================
# ADMIN - LOGO SETTING
# =========================================================

@app.route(
    "/api/admin/settings/logo",
    methods=["POST"]
)
@token_required
def admin_logo_locked(admin):

    return jsonify({
        "error": "Logo editing is locked"
    }), 403


# =========================================================
# ADMIN - BANNER
# =========================================================

@app.route(
    "/api/admin/settings/banner",
    methods=["POST"]
)
@token_required
def admin_banner(admin):

    image = request.files.get(
        "image"
    )

    if not image:

        return jsonify({
            "error": "Image is required"
        }), 400

    try:

        result = cloudinary.uploader.upload(
            image,
            folder="plotx/banner"
        )

        setting = SiteSetting.query.filter_by(
            key="banner"
        ).first()

        if not setting:

            setting = SiteSetting(
                key="banner"
            )

            db.session.add(setting)

        setting.value = result.get(
            "secure_url"
        )

        db.session.commit()

        return jsonify({
            "success": True,
            "banner": setting.value
        })

    except Exception as e:

        print(
            "BANNER ERROR:",
            e
        )

        return jsonify({
            "error": "Banner upload failed"
        }), 500


@app.route(
    "/api/admin/settings/banner",
    methods=["DELETE"]
)
@token_required
def admin_delete_banner(admin):

    setting = SiteSetting.query.filter_by(
        key="banner"
    ).first()

    if setting:

        db.session.delete(setting)
        db.session.commit()

    return jsonify({
        "success": True
    })


# =========================================================
# DATABASE INITIALIZATION
# =========================================================

with app.app_context():

    db.create_all()

    # -----------------------------------------------------
    # Safe schema upgrades for existing PostgreSQL database
    # -----------------------------------------------------

    try:

        db.session.execute(
            db.text(
                "ALTER TABLE admin "
                "ADD COLUMN IF NOT EXISTS created_at "
                "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
            )
        )

        db.session.commit()

    except Exception:

        db.session.rollback()

    # -----------------------------------------------------
    # Add columns missing from older poster tables
    # -----------------------------------------------------

    try:
        db.session.execute(
            db.text(
                "ALTER TABLE poster "
                "ADD COLUMN IF NOT EXISTS image_url TEXT"
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        app.logger.exception("Could not upgrade poster table schema")

    try:
        db.session.execute(
            db.text(
                "ALTER TABLE poster "
                "ADD COLUMN IF NOT EXISTS public_id VARCHAR(255)"
            )
        )
        db.session.commit()
    except Exception:
        db.session.rollback()
        app.logger.exception("Could not add poster.public_id column")

    # -----------------------------------------------------
    # -----------------------------------------------------
    # Make optional site_user fields nullable on older databases.
    # The Get in Touch route creates users without a password, so an
    # older NOT NULL password_hash constraint can cause a database 500.
    # Run each migration separately so one failed statement does not
    # prevent the remaining compatibility fixes.
    # -----------------------------------------------------

    for migration_sql, migration_label in (
        (
            "ALTER TABLE site_user ALTER COLUMN phone DROP NOT NULL",
            "site_user.phone nullable",
        ),
        (
            "ALTER TABLE site_user ALTER COLUMN email DROP NOT NULL",
            "site_user.email nullable",
        ),
        (
            "ALTER TABLE site_user ALTER COLUMN password_hash DROP NOT NULL",
            "site_user.password_hash nullable",
        ),
    ):
        try:
            db.session.execute(db.text(migration_sql))
            db.session.commit()
        except Exception:
            db.session.rollback()
            app.logger.exception("Could not apply database migration: %s", migration_label)

    # -----------------------------------------------------
    # Create / update admin
    # -----------------------------------------------------

    admin_username = os.environ.get(
        "ADMIN_USERNAME",
        "admin"
    )

    admin_password = os.environ.get(
        "ADMIN_PASSWORD"
    ) or os.environ.get(
        "ADMIN_DEFAULT_PASSWORD"
    ) or "plotx2024"

    admin = Admin.query.filter_by(
        username=admin_username
    ).first()

    if not admin:

        admin = Admin(
            username=admin_username,
            password_hash=generate_password_hash(
                admin_password
            )
        )

        db.session.add(admin)
        db.session.commit()

    else:

        # Only update password if explicitly provided
        explicit_password = (
            os.environ.get("ADMIN_PASSWORD")
            or os.environ.get("ADMIN_DEFAULT_PASSWORD")
        )

        if explicit_password:

            admin.password_hash = (
                generate_password_hash(
                    explicit_password
                )
            )

            db.session.commit()


# =========================================================
# START SERVER
# =========================================================

if __name__ == "__main__":

    port = int(
        os.environ.get(
            "PORT",
            5000
        )
    )

    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )
