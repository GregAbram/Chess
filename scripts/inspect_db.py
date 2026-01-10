import sqlite3
import os
from pathlib import Path

DB = Path(__file__).resolve().parents[0] / '..' / 'db.sqlite3'
DB = DB.resolve()
print('DB path:', DB)
if not DB.exists():
    print('Database not found at', DB)
    raise SystemExit(1)

conn = sqlite3.connect(str(DB))
cur = conn.cursor()

print('\nTables:')
for row in cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall():
    print(' -', row[0])


def dump_table(name, limit=20):
    try:
        cur.execute(f"PRAGMA table_info('{name}')")
        cols = [r[1] for r in cur.fetchall()]
        print(f"\n{name} columns: {cols}")
        cur.execute(f"SELECT * FROM '{name}' LIMIT {limit}")
        rows = cur.fetchall()
        for r in rows:
            print(r)
    except Exception as e:
        print('Could not read', name, '->', e)

# Common Django table names
candidates = ['users_game', 'users_customuser', 'auth_user', 'auth_user_groups']
for c in candidates:
    if cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (c,)).fetchone():
        dump_table(c)

# If users_game exists, show games with NULL slots
if cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users_game'").fetchone():
    print('\nGames with NULL white or black:')
    for r in cur.execute("SELECT id, white_id, black_id, in_game, over FROM users_game ORDER BY id").fetchall():
        print(r)

# Show users and their linked game ids if any
if cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users_customuser'").fetchone():
    print('\nCustomUsers game links: (id, username, game_id)')
    for r in cur.execute("SELECT id, username, game_id FROM users_customuser ORDER BY id").fetchall():
        print(r)

conn.close()
print('\nDone')
