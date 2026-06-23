import firebase_admin
from firebase_admin import credentials
import os


def init():
    if firebase_admin._apps:
        return  # Already initialized — guard against double-init
    sa_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    if sa_path and os.path.exists(sa_path):
        firebase_admin.initialize_app(credentials.Certificate(sa_path))
    else:
        # Application Default Credentials — pass projectId explicitly so Firebase
        # can resolve it without a service account.
        project_id = os.getenv('FIREBASE_PROJECT_ID') or os.getenv('GOOGLE_CLOUD_PROJECT')
        options = {'projectId': project_id} if project_id else {}
        firebase_admin.initialize_app(options=options)
