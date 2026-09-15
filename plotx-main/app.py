from flask import Flask, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import jwt, datetime, os, uuid, re
import cloudinary
import cloudinary.uploader
from functools import wraps

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
            jwt.decode(
                token,
                app.config['SECRET_KEY'],
                algorithms=['HS256']
            )

        except Exception:
            return jsonify({
                'error': 'Invalid token'
            }), 401

        return f(*args, **kwargs)

    return decorated


# ─── Public Routes ─────────────────────────────────────────────────────────────

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

    return jsonify([
        p.to_dict()
        for p in posters
    ])


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


# ─── Admin Auth ────────────────────────────────────────────────────────────────

@app.route('/api/admin/login', methods=['POST'])
def admin_login():

    data = request.json or {}

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
                + datetime.timedelta(hours=24)
            },
            app.config['SECRET_KEY'],
            algorithm='HS256'
        )

        return jsonify({
            'token': token
        })

    return jsonify({
        'error': 'Invalid credentials'
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

    p = Poster.query.filter_by(
        custom_id=identifier
    ).first()

    if not p and identifier.isdigit():
        p = Poster.query.get(
            int(identifier)
        )

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

    if not Admin.query.filter_by(
        username='admin'
    ).first():

        default_pass = os.environ.get(
            'ADMIN_DEFAULT_PASSWORD',
            'plotx2024'
        )

        db.session.add(
            Admin(
                username='admin',
                password_hash=generate_password_hash(
                    default_pass
                )
            )
        )

        db.session.commit()


# ─── Run ───────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    app.run(debug=True)
