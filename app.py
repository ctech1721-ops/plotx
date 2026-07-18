from flask import Flask, request, jsonify, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import jwt, datetime, os
from functools import wraps

app = Flask(__name__)


CORS(app, resources={r"/api/*": {"origins": "*"}})


database_url = os.environ.get('DATABASE_URL', 'sqlite:///plotx.db')
if database_url.startswith('postgres://'):
    database_url = database_url.replace('postgres://', 'postgresql://', 1)
 
app.config['SQLALCHEMY_DATABASE_URI'] = database_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

db = SQLAlchemy(app)
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)




class Admin(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)


class Poster(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    custom_id = db.Column(db.String(50))
    title = db.Column(db.String(200), nullable=False)
    location = db.Column(db.String(200))
    purpose = db.Column(db.String(50))
    category = db.Column(db.String(50), nullable=False)
    sub_category = db.Column(db.String(100))
    price = db.Column(db.String(100))
    area = db.Column(db.String(50))
    description = db.Column(db.Text)
    features = db.Column(db.Text)
    cleared = db.Column(db.String(10))
    landowner_share = db.Column(db.Integer)
    developer_share = db.Column(db.Integer)
    image_path = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

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
            'features': (self.features or '').split(',') if self.features else [],
            'cleared': self.cleared,
            'landownerShare': self.landowner_share,
            'developerShare': self.developer_share,
            'image': self.image_path,
            'created_at': self.created_at.isoformat()
        }


class Lead(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120))
    mobile = db.Column(db.String(20), nullable=False)
    interest = db.Column(db.String(200))
    service = db.Column(db.String(100))
    source_context = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)

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




def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({'error': 'Token missing'}), 401
        try:
            jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        except Exception:
            return jsonify({'error': 'Invalid token'}), 401
        return f(*args, **kwargs)
    return decorated


# ─── Public Routes ─────────────────────────────────────────────────────────────

@app.route('/api/posters', methods=['GET'])
def get_posters():
    purpose = request.args.get('purpose')
    category = request.args.get('category')
    q = Poster.query
    if purpose and purpose != 'All Listings':
        q = q.filter_by(purpose=purpose)
    if category and category != 'All Types':
        q = q.filter_by(category=category)
    posters = q.order_by(Poster.created_at.desc()).all()
    return jsonify([p.to_dict() for p in posters])


@app.route('/api/leads', methods=['POST'])
def submit_lead():
    data = request.json or {}
    if not data.get('name') or not data.get('mobile'):
        return jsonify({'error': 'name and mobile are required'}), 400
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
    return jsonify({'message': 'Lead submitted successfully'}), 201


# ─── Admin Auth ────────────────────────────────────────────────────────────────

@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.json or {}
    admin = Admin.query.filter_by(username=data.get('username')).first()
    if admin and check_password_hash(admin.password_hash, data.get('password', '')):
        token = jwt.encode({
            'admin_id': admin.id,
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm='HS256')
        return jsonify({'token': token})
    return jsonify({'error': 'Invalid credentials'}), 401


# ─── Admin Protected Routes ────────────────────────────────────────────────────

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/api/admin/posters', methods=['POST'])
@token_required
def upload_poster():
    form = request.form
    image_path = None
    if 'image' in request.files and request.files['image'].filename:
        f = request.files['image']
        filename = secure_filename(f.filename)
        path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        f.save(path)
        image_path = f'/uploads/{filename}'

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
    return jsonify({'message': 'Poster uploaded', 'poster': poster.to_dict()}), 201


@app.route('/api/admin/posters/<identifier>', methods=['DELETE'])
@token_required
def delete_poster(identifier):
    p = Poster.query.filter_by(custom_id=identifier).first()
    if not p and identifier.isdigit():
        p = Poster.query.get(int(identifier))
    if not p:
        return jsonify({'error': 'Not found'}), 404
    db.session.delete(p)
    db.session.commit()
    return jsonify({'message': 'Deleted'})


@app.route('/api/admin/leads', methods=['GET'])
@token_required
def get_leads():
    leads = Lead.query.order_by(Lead.created_at.desc()).all()
    return jsonify([l.to_dict() for l in leads])


# ─── Init ──────────────────────────────────────────────────────────────────────

@app.route('/health')
def health():
    return {'status': 'ok'}, 200

with app.app_context():
    db.create_all()
    if not Admin.query.filter_by(username='admin').first():
        default_pass = os.environ.get('ADMIN_DEFAULT_PASSWORD', 'plotx2024')
        db.session.add(Admin(username='admin', password_hash=generate_password_hash(default_pass)))
        db.session.commit()

if __name__ == '__main__':
    app.run(debug=True)
