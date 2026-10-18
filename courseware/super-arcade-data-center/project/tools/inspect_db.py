
"""Read-only audit: open the exact database path without creating a missing file."""
import argparse
from pathlib import Path
import sqlite3
parser=argparse.ArgumentParser()
parser.add_argument('database')
args=parser.parse_args()
path=Path(args.database).resolve()
with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:
    print('integrity:',db.execute('PRAGMA integrity_check').fetchone()[0])
    print('players:',db.execute('SELECT player,coins FROM players ORDER BY player').fetchall())
    print('ledger_count:',db.execute('SELECT COUNT(*) FROM ledger').fetchone()[0])
    print('request_count:',db.execute('SELECT COUNT(*) FROM requests').fetchone()[0])
    mismatch=db.execute('SELECT p.player,p.coins,COALESCE(SUM(l.delta),0) FROM players p LEFT JOIN ledger l ON p.player=l.player GROUP BY p.player HAVING p.coins<>COALESCE(SUM(l.delta),0)').fetchall()
    if mismatch: raise SystemExit('balance/ledger mismatch: '+repr(mismatch))
    print('AUDIT OK')
