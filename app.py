import os
from flask import Flask, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import jwt, datetime, os, uuid, re
import cloudinary
import cloudinary.uploader
import secrets
from functools import wraps

try:
    from flask_compress import Compress
except ImportError:  # app still runs without it
    Compress = None

app = Flask(__name__)

# ─── App Config ────────────────────────────────────────────────────────────────

app.config['SECRET_KEY'] = os.environ.get(
    'SECRET_KEY',
    'dev-fallback-change-me'
)
cloudinary.config(
    cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
    api_key=os.environ.get('CLOUDINARY_API_KEY'),
    api_secret=os.environ.get('CLOUDINARY_API_SECRET')
)

CORS(app, resources={r"/api/*": {"origins": "*"}})
if Compress:
    Compress(app)  # gzip JSON responses: much smaller + faster on mobile data


# ─── Database Config ───────────────────────────────────────────────────────────

database_url = os.environ.get('DATABASE_URL')

if not database_url:
    raise RuntimeError("DATABASE_URL is not configured.")

# Render/Aiven may provide postgres://
# SQLAlchemy expects postgresql://
if database_url.startswith('postgres://'):
    database_url = database_url.replace(
        'postgres://',
        'postgresql://',
        1
    )

app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False


# ─── Upload Config ─────────────────────────────────────────────────────────────

app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

db = SQLAlchemy(app)

os.makedirs(
    app.config['UPLOAD_FOLDER'],
    exist_ok=True
)


# ─── Models ────────────────────────────────────────────────────────────────────

class Admin(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(
        db.String(80),
        unique=True,
        nullable=False
    )
    password_hash = db.Column(
        db.String(255),
        nullable=False
    )


class Poster(db.Model):
    id = db.Column(
        db.Integer,
        primary_key=True
    )

    custom_id = db.Column(
        db.String(50)
    )

    title = db.Column(
        db.String(200),
        nullable=False
    )

    location = db.Column(
        db.String(200)
    )

    purpose = db.Column(
        db.String(50)
    )

    category = db.Column(
        db.String(50),
        nullable=False
    )

    sub_category = db.Column(
        db.String(100)
    )

    price = db.Column(
        db.String(100)
    )

    area = db.Column(
        db.String(50)
    )

    description = db.Column(
        db.Text
    )

    features = db.Column(
        db.Text
    )

    cleared = db.Column(
        db.String(10)
    )

    landowner_share = db.Column(
        db.Integer
    )

    developer_share = db.Column(
        db.Integer
    )

    image_path = db.Column(
        db.String(255)
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.datetime.utcnow
    )

    def to_dict(self):
        return {
            'id': self.custom_id or str(self.id),
            'db_id': self.id,
            'title': self.title,
            'location': self.location,
            'purpose': self.purpose,
            'category': self.category,
            'subcategory': self.sub_category,
            'price': self.price,
            'area': self.area,
            'description': self.description,
            'features': (
                (self.features or '').split(',')
                if self.features
                else []
            ),
            'cleared': self.cleared,
            'landownerShare': self.landowner_share,
            'developerShare': self.developer_share,
            'image': self.image_path,
            'created_at': self.created_at.isoformat()
        }


class SiteSetting(db.Model):
    id = db.Column(
        db.Integer,
        primary_key=True
    )

    key = db.Column(
        db.String(50),
        unique=True,
        nullable=False
    )

    value = db.Column(
        db.String(255),
        nullable=False
    )


class Lead(db.Model):
    id = db.Column(
        db.Integer,
        primary_key=True
    )

    name = db.Column(
        db.String(100),
        nullable=False
    )

    email = db.Column(
        db.String(120)
    )

    mobile = db.Column(
        db.String(20),
        nullable=False
    )

    interest = db.Column(
        db.String(200)
    )

    service = db.Column(
        db.String(100)
    )

    source_context = db.Column(
        db.String(500)
    )

    created_at = db.Column(
        db.DateTime,
        default=datetime.datetime.utcnow
    )

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'email': self.email,
            'mobile': self.mobile,
            'interest': self.interest,
            'service': self.service,
            'context': self.source_context,
            'date': self.created_at.isoformat()
        }


class OtpCode(db.Model):
    __tablename__ = 'otp_code'
    id = db.Column(db.Integer, primary_key=True)
    target = db.Column(db.String(120), index=True, nullable=False)
    code_hash = db.Column(db.String(255), nullable=False)
    expires = db.Column(db.DateTime, nullable=False)
    tries = db.Column(db.Integer, default=0)


class SiteUser(db.Model):
    """Customers who create an account / sign in on the public website."""
    __tablename__ = 'site_user'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(15), unique=True, nullable=True, index=True)
    email = db.Column(db.String(120), index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    last_login_at = db.Column(db.DateTime)
    login_count = db.Column(db.Integer, default=0)

    def to_public(self):
        return {'id': self.id, 'name': self.name, 'phone': self.phone, 'email': self.email or '',
                'created': self.created_at.isoformat()}

    def to_admin(self):
        # password hash is never sent anywhere
        d = self.to_public()
        d.update({'email': self.email or '','lastLogin': self.last_login_at.isoformat() if self.last_login_at else None,
                  'loginCount': self.login_count or 0})
        return d


# ─── Authentication ───────────────────────────────────────────────────────────

def token_required(f):

    @wraps(f)
    def decorated(*args, **kwargs):

        token = request.headers.get(
            'Authorization',
            ''
        ).replace(
            'Bearer ',
            ''
        )

        if not token:
            return jsonify({
                'error': 'Token missing'
            }), 401

        try:
            payload = jwt.decode(
                token,
                app.config['SECRET_KEY'],
                algorithms=['HS256']
            )
            # customer tokens must never unlock admin routes
            if 'admin_id' not in payload:
                raise ValueError('not an admin token')

        except Exception:
            return jsonify({
                'error': 'Invalid token'
            }), 401

        return f(*args, **kwargs)

    return decorated


# ─── Public Routes ─────────────────────────────────────────────────────────────
@app.route('/')
def home():
    return send_from_directory('.', 'index.html')

@app.route('/api/posters', methods=['GET'])
def get_posters():

    purpose = request.args.get('purpose')
    category = request.args.get('category')

    q = Poster.query

    if purpose and purpose != 'All Listings':
        q = q.filter_by(
            purpose=purpose
        )

    if category and category != 'All Types':
        q = q.filter_by(
            category=category
        )

    posters = q.order_by(
        Poster.created_at.desc()
    ).all()

    resp = jsonify([
        p.to_dict()
        for p in posters
    ])
    # short cache + ETag: repeat visits and polling become tiny 304 responses
    resp.headers['Cache-Control'] = 'public, max-age=20'
    resp.add_etag()
    return resp.make_conditional(request)


@app.route('/api/settings', methods=['GET'])
def get_settings():

    rows = SiteSetting.query.all()

    settings = {
        row.key: row.value
        for row in rows
    }

    return jsonify({
        'logo': settings.get('logo'),
        'banner': settings.get('banner')
    })


@app.route('/api/leads', methods=['POST'])
def submit_lead():

    data = request.json or {}

    if not data.get('name') or not data.get('mobile'):
        return jsonify({
            'error': 'name and mobile are required'
        }), 400

    lead = Lead(
        name=data['name'],
        email=data.get('email'),
        mobile=data['mobile'],
        interest=data.get('interest'),
        service=data.get('service'),
        source_context=data.get('context')
    )

    db.session.add(lead)
    db.session.commit()

    return jsonify({
        'message': 'Lead submitted successfully'
    }), 201


# ─── Customer accounts ─────────────────────────────────────────────────────────

def _user_token(user):
    return jwt.encode(
        {'user_id': user.id,
         'exp': datetime.datetime.utcnow() + datetime.timedelta(days=30)},
        app.config['SECRET_KEY'], algorithm='HS256')


def _clean_phone(raw):
    phone = re.sub(r'\D', '', str(raw or ''))[-10:]
    return phone if re.fullmatch(r'[6-9]\d{9}', phone) else None


def _send_otp(channel, phone, email, code):
    """Send OTP through MSG91 (SMS) or Resend (email)."""
    import json, urllib.request
    try:
        if channel == 'sms':
            authkey = os.environ.get('MSG91_AUTHKEY')
            template_id = os.environ.get('MSG91_OTP_TEMPLATE_ID')
            if not authkey or not template_id or not phone:
                app.logger.error('MSG91 SMS OTP is not configured.')
                return False
            payload = {
                'template_id': template_id,
                'short_url': '0',
                'recipients': [{'mobiles': '91' + phone, os.environ.get('MSG91_OTP_VAR', 'VAR1'): code}]
            }
            req = urllib.request.Request(
                'https://control.msg91.com/api/v5/flow', data=json.dumps(payload).encode(),
                headers={'authkey': authkey, 'accept': 'application/json', 'content-type': 'application/json'}, method='POST')
            with urllib.request.urlopen(req, timeout=15) as r:
                body = r.read().decode('utf-8', 'ignore')
                if r.status < 200 or r.status >= 300:
                    app.logger.error('MSG91 OTP failed: HTTP %s %s', r.status, body[:500])
                    return False
                return True
        if channel == 'email':
            api_key = os.environ.get('RESEND_API_KEY')
            from_email = os.environ.get('RESEND_FROM_EMAIL')
            if not api_key or not from_email or not email:
                app.logger.error('Resend email OTP is not configured.')
                return False
            html = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px">'
            html += '<h2 style="color:#6b4d16">Plot X Realty</h2><p>Your one-time sign-in code is:</p>'
            html += '<div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0">%s</div>' % code
            html += '<p>This code expires in <b>10 minutes</b>. If you did not request it, you can ignore this email.</p></div>'
            payload = {'from': from_email, 'to': [email], 'subject': 'Your Plot X Realty login code', 'html': html}
            req = urllib.request.Request(
                'https://api.resend.com/emails', data=json.dumps(payload).encode(),
                headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}, method='POST')
            with urllib.request.urlopen(req, timeout=15) as r:
                body = r.read().decode('utf-8', 'ignore')
                if r.status < 200 or r.status >= 300:
                    app.logger.error('Resend OTP failed: HTTP %s %s', r.status, body[:500])
                    return False
                return True
    except Exception as e:
        app.logger.error('OTP send failed: %s', e)
        return False
    return False


@app.route('/api/health', methods=['GET'])
def api_health():
    return jsonify({'ok': True, 'service': 'plotx-api'})


@app.route('/api/users/otp/request', methods=['POST'])
def otp_request():
    d = request.json or {}
    channel = 'email' if d.get('channel') == 'email' else 'sms'
    name = (d.get('name') or '').strip()[:100]
    phone = _clean_phone(d.get('phone'))
    email = (d.get('email') or '').strip().lower()
    if len(name) < 2: return jsonify({'error': 'Enter your name.'}), 400
    if channel == 'sms' and not phone: return jsonify({'error': 'Enter a valid 10-digit mobile number.'}), 400
    if channel == 'email' and not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email): return jsonify({'error': 'Enter a valid email address.'}), 400
    target = email if channel == 'email' else phone
    code = f'{secrets.randbelow(10**6):06d}'
    OtpCode.query.filter_by(target=target).delete()
    db.session.add(OtpCode(target=target, code_hash=generate_password_hash(code), expires=datetime.datetime.utcnow() + datetime.timedelta(minutes=10)))
    db.session.commit()
    if not _send_otp(channel, phone, email, code):
        db.session.rollback()
        return jsonify({'error': 'Could not send the OTP. Please try again later.'}), 502
    return jsonify({'sent': True, 'channel': channel})

@app.route('/api/users/otp/verify', methods=['POST'])
def otp_verify():
    d = request.json or {}
    channel = 'email' if d.get('channel') == 'email' else 'sms'
    name = (d.get('name') or '').strip()[:100]
    phone = _clean_phone(d.get('phone'))
    email = (d.get('email') or '').strip().lower()
    target = email if channel == 'email' else phone
    if not target: return jsonify({'error': 'Enter your login contact.'}), 400
    rec = OtpCode.query.filter_by(target=target).first()
    if not rec or rec.expires < datetime.datetime.utcnow() or (rec.tries or 0) >= 5: return jsonify({'error': 'Code expired. Request a new OTP.'}), 400
    rec.tries = (rec.tries or 0) + 1
    if not check_password_hash(rec.code_hash, str(d.get('code') or '').strip()):
        db.session.commit(); return jsonify({'error': 'Wrong OTP.'}), 401
    db.session.delete(rec)
    now = datetime.datetime.utcnow()
    if channel == 'email':
        user = SiteUser.query.filter(db.func.lower(SiteUser.email) == email).first()
        if not user:
            user = SiteUser(name=name, phone=None, email=email, password_hash=generate_password_hash(secrets.token_hex(16)), login_count=0)
            db.session.add(user)
    else:
        user = SiteUser.query.filter_by(phone=phone).first()
        if not user:
            user = SiteUser(name=name, phone=phone, email=None, password_hash=generate_password_hash(secrets.token_hex(16)), login_count=0)
            db.session.add(user)
    if name: user.name = name
    if email: user.email = email
    if phone: user.phone = phone
    user.last_login_at = now; user.login_count = (user.login_count or 0) + 1
    db.session.commit()
    return jsonify({'token': _user_token(user), 'user': user.to_public()})

@app.route('/api/users/register', methods=['POST'])
def user_register():
    data = request.json or {}
    name = (data.get('name') or '').strip()[:100]
    phone = _clean_phone(data.get('phone'))
    password = data.get('password') or ''

    if len(name) < 2:
        return jsonify({'error': 'Enter your name.'}), 400
    if not phone:
        return jsonify({'error': 'Enter a valid 10-digit mobile number.'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters.'}), 400
    if SiteUser.query.filter_by(phone=phone).first():
        return jsonify({'error': 'This number already has an account. Sign in instead.'}), 409

    now = datetime.datetime.utcnow()
    user = SiteUser(name=name, phone=phone,
                    password_hash=generate_password_hash(password),
                    last_login_at=now, login_count=1)
    db.session.add(user)
    db.session.commit()
    return jsonify({'token': _user_token(user), 'user': user.to_public()}), 201


@app.route('/api/users/login', methods=['POST'])
def user_login():
    data = request.json or {}
    phone = _clean_phone(data.get('phone'))
    user = SiteUser.query.filter_by(phone=phone).first() if phone else None

    if not user or not check_password_hash(user.password_hash, data.get('password') or ''):
        return jsonify({'error': 'Wrong phone number or password.'}), 401

    user.last_login_at = datetime.datetime.utcnow()
    user.login_count = (user.login_count or 0) + 1
    db.session.commit()
    return jsonify({'token': _user_token(user), 'user': user.to_public()})


@app.route('/api/users/me', methods=['GET'])
def user_me():
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        user = SiteUser.query.get(payload['user_id'])
    except Exception:
        user = None
    if not user:
        return jsonify({'error': 'Invalid token'}), 401
    return jsonify({'user': user.to_public()})


# ─── Admin Auth ────────────────────────────────────────────────────────────────

_LOGIN_FAILS = {}   # ip -> [timestamps]; single gunicorn worker so memory is fine
_MAX_FAILS, _WINDOW = 5, 15 * 60


def _client_ip():
    return (request.headers.get('X-Forwarded-For', request.remote_addr or '')
            .split(',')[0].strip())


@app.route('/api/admin/login', methods=['POST'])
def admin_login():

    data = request.get_json(silent=True) or {}

    ip = _client_ip()
    now_ts = datetime.datetime.utcnow().timestamp()
    fails = [t for t in _LOGIN_FAILS.get(ip, []) if now_ts - t < _WINDOW]
    _LOGIN_FAILS[ip] = fails
    if len(fails) >= _MAX_FAILS:
        return jsonify({'error': 'Too many wrong attempts. Try again in 15 minutes.'}), 429

    admin = Admin.query.filter_by(
        username=data.get('username')
    ).first()

    if admin and check_password_hash(
        admin.password_hash,
        data.get('password', '')
    ):

        token = jwt.encode(
            {
                'admin_id': admin.id,
                'exp': datetime.datetime.utcnow()
                + datetime.timedelta(hours=2)
            },
            app.config['SECRET_KEY'],
            algorithm='HS256'
        )

        _LOGIN_FAILS.pop(ip, None)
        return jsonify({
            'token': token
        })

    _LOGIN_FAILS.setdefault(ip, []).append(now_ts)
    return jsonify({
        'error': 'Wrong password. Please try again.'
    }), 401


# ─── Admin Protected Routes ────────────────────────────────────────────────────

@app.route('/uploads/<filename>')
def uploaded_file(filename):

    return send_from_directory(
        app.config['UPLOAD_FOLDER'],
        filename
    )


@app.route('/api/admin/posters', methods=['POST'])
@token_required
def upload_poster():

    form = request.form
    image_path = None

    if (
        'image' in request.files
        and request.files['image'].filename
    ):
        f = request.files['image']

        try:
            # IMPORTANT: Render's local filesystem is ephemeral. Store every
            # property image permanently in Cloudinary instead of /uploads.
            public_id = f"poster_{uuid.uuid4().hex}"
            result = cloudinary.uploader.upload(
                f,
                folder='plotx/posters',
                public_id=public_id,
                resource_type='image',
                type='upload',
                unique_filename=False,
                overwrite=False,
                invalidate=True
            )
            image_path = result.get('secure_url')
            if not image_path:
                raise RuntimeError('Cloudinary did not return a secure image URL.')
        except Exception as e:
            return jsonify({
                'error': 'Property image upload failed',
                'details': str(e)
            }), 500

    poster = Poster(
        custom_id=form.get('custom_id'),
        title=form.get('title'),
        location=form.get('location'),
        purpose=form.get('purpose'),
        category=form.get('category'),
        sub_category=form.get('sub_category'),
        price=form.get('price'),
        area=form.get('area'),
        description=form.get('description'),
        features=form.get('features'),
        cleared=form.get('cleared'),
        landowner_share=form.get('landowner_share') or None,
        developer_share=form.get('developer_share') or None,
        image_path=image_path
    )

    db.session.add(poster)
    db.session.commit()

    return jsonify({
        'message': 'Poster uploaded',
        'poster': poster.to_dict()
    }), 201


@app.route(
    '/api/admin/posters/<identifier>',
    methods=['DELETE']
)
@token_required
def delete_poster(identifier):

    p = None
    if identifier.isdigit():
        p = Poster.query.get(int(identifier))   # unique database id (preferred)

    if not p:
        p = Poster.query.filter_by(
            custom_id=identifier
        ).first()

    if not p:
        return jsonify({
            'error': 'Not found'
        }), 404

    # Delete the associated Cloudinary image when the post is deleted.
    # Images from the old /uploads/ storage are left untouched because they
    # are not Cloudinary assets.
    if p.image_path and 'res.cloudinary.com' in p.image_path:
        try:
            parts = p.image_path.split('/upload/', 1)
            if len(parts) == 2:
                cloud_path = parts[1]
                cloud_path = re.sub(r'^v\\d+/', '', cloud_path)
                public_id = re.sub(r'\\.[A-Za-z0-9]+$', '', cloud_path)
                if public_id:
                    cloudinary.uploader.destroy(
                        public_id,
                        resource_type='image',
                        type='upload',
                        invalidate=True
                    )
        except Exception as e:
            # Do not leave the database post undeleted just because Cloudinary
            # cleanup failed. The API response reports the cleanup warning.
            db.session.rollback()
            return jsonify({
                'error': 'Cloudinary image deletion failed',
                'details': str(e)
            }), 500

    db.session.delete(p)
    db.session.commit()

    return jsonify({
        'message': 'Deleted'
    })


@app.route('/api/admin/leads', methods=['GET'])
@token_required
def get_leads():

    leads = Lead.query.order_by(
        Lead.created_at.desc()
    ).all()

    return jsonify([
        l.to_dict()
        for l in leads
    ])


@app.route('/api/admin/users', methods=['GET'])
@token_required
def get_users():

    users = SiteUser.query.order_by(
        SiteUser.created_at.desc()
    ).all()

    return jsonify([u.to_admin() for u in users])


# ─── Image Settings ────────────────────────────────────────────────────────────

def _save_setting_image(key):

    if 'image' not in request.files or not request.files['image'].filename:
        return jsonify({'error': 'No image provided'}), 400

    f = request.files['image']

    try:
        # Upload image to Cloudinary permanently
        result = cloudinary.uploader.upload(
            f,
            folder='plotx/settings',
            public_id=key,
            overwrite=True,
            resource_type='image'
        )

        # Permanent Cloudinary URL
        url_path = result['secure_url']

        # Save URL in PostgreSQL
        row = SiteSetting.query.filter_by(key=key).first()

        if row:
            row.value = url_path
        else:
            row = SiteSetting(
                key=key,
                value=url_path
            )
            db.session.add(row)

        db.session.commit()

        return jsonify({
            key: url_path
        }), 200

    except Exception as e:
        db.session.rollback()

        return jsonify({
            'error': 'Image upload failed',
            'details': str(e)
        }), 500

@app.route(
    '/api/admin/settings/logo',
    methods=['POST', 'DELETE']
)
@token_required
def locked_logo_endpoint():
    return jsonify({
        'error': 'Logo is locked and cannot be changed.'
    }), 403


@app.route(
    '/api/admin/settings/banner',
    methods=['POST']
)
@token_required
def upload_banner():

    return _save_setting_image('banner')


@app.route(
    '/api/admin/settings/banner',
    methods=['DELETE']
)
@token_required
def reset_banner():

    SiteSetting.query.filter_by(
        key='banner'
    ).delete()

    db.session.commit()

    return jsonify({
        'message': 'Banner reset to default'
    })


# ─── Health Check ──────────────────────────────────────────────────────────────

@app.route('/health')
def health():

    return {
        'status': 'ok'
    }, 200


# ─── Database Initialization ───────────────────────────────────────────────────

with app.app_context():

    db.create_all()
    try:
        from sqlalchemy import text
        db.session.execute(text('ALTER TABLE site_user ALTER COLUMN phone DROP NOT NULL'))
        db.session.commit()
    except Exception:
        db.session.rollback()

    # Dashboard password: set ADMIN_PASSWORD on Render to use your own.
    # The old default (plotx2024) is replaced automatically on startup.
    _new_pass = os.environ.get('ADMIN_PASSWORD') or os.environ.get(
        'ADMIN_DEFAULT_PASSWORD') or 'plotx2024'
    _admin = Admin.query.filter_by(username='admin').first()

    if not _admin:
        db.session.add(Admin(username='admin',
                             password_hash=generate_password_hash(_new_pass)))
    elif (os.environ.get('ADMIN_PASSWORD')
          or check_password_hash(_admin.password_hash, 'plotx2024')):
        _admin.password_hash = generate_password_hash(_new_pass)

    db.session.commit()


# ─── Run ───────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    app.run(debug=True)
