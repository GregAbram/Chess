import sqlite3
from pathlib import Path
DB = Path(__file__).resolve().parents[0] / '..' / 'db.sqlite3'
DB = DB.resolve()
conn = sqlite3.connect(str(DB))
cur = conn.cursor()

def find_open_for_user(uid):
    q = """
    SELECT id, white_id, black_id FROM users_game
    WHERE (white_id IS NULL OR black_id IS NULL)
    AND (white_id != ? AND black_id != ?)
    ORDER BY id
    """
    rows = cur.execute(q, (uid, uid)).fetchall()
    print(f"Open games for user {uid}: {rows}")

for uid in [1,2,3]:
    find_open_for_user(uid)

conn.close()
print('done')
