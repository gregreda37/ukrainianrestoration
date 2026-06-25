import firebase_admin
from firebase_admin import credentials
import os


def init():
    if firebase_admin._apps:
        return  # Already initialized — guard against double-init

    project_id   = os.getenv('FIREBASE_PROJECT_ID') or os.getenv('GOOGLE_CLOUD_PROJECT')
    storage_bucket = os.getenv(
        'FIREBASE_STORAGE_BUCKET',
        f"{project_id}.appspot.com" if project_id else "",
    )
    options = {}
    if project_id:
        options['projectId'] = project_id
    if storage_bucket:
        options['storageBucket'] = storage_bucket

    sa_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    if sa_path and os.path.exists(sa_path):
        firebase_admin.initialize_app(credentials.Certificate(sa_path), options)
    else:
        firebase_admin.initialize_app(options=options)
