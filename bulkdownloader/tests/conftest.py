import sys
from pathlib import Path

# Make the bulkdownloader package dir importable (bulk_db.py lives one level up).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
