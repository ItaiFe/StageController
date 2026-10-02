from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
DATA_DIR = BASE_DIR / "data"
MUSIC_DIR = DATA_DIR / "music"
DATABASE_PATH = DATA_DIR / "db.sqlite"

# Ensure directories exist
DATA_DIR.mkdir(exist_ok=True)
MUSIC_DIR.mkdir(exist_ok=True)

# API settings
API_PREFIX = "/api"

# Upload settings
MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100MB
ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".flac", ".wav", ".ogg", ".aac", ".m4a", ".wma"}
