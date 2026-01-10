import sqlite3
from pathlib import Path
DB = Path(__file__).resolve().parents[0] / '..' / 'db.sqlite3'
DB = DB.resolve()
conn = sqlite3.connect(str(DB))
cur = conn.cursor()

print('PRAGMA table_info users_game:')
cols = cur.execute("PRAGMA table_info('users_game')").fetchall()
for c in cols:
    print(c)

print('\nAll rows (select *):')
rows = cur.execute('SELECT * FROM users_game ORDER BY id').fetchall()
for r in rows:
    print(r)

# Show mapping per row
col_names = [c[1] for c in cols]
print('\nMapping rows with column names:')
for r in rows:
    print({col_names[i]: r[i] for i in range(len(col_names))})

conn.close()
print('done')
