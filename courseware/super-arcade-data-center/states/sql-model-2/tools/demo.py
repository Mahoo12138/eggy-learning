import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
DEMO_PLAYER = "alice"
DEMO_AMOUNT = 5
from harness import *
with stack() as (port,db):
    print(rpc(port,'PING|'+DEMO_PLAYER,framed=True))
import sqlite3
with sqlite3.connect(':memory:') as db:
    db.executescript((ROOT/'db/schema.sql').read_text())
    db.execute('INSERT INTO players(player,coins) VALUES(?,?)',(DEMO_PLAYER,DEMO_AMOUNT))
    print('SQL',db.execute('SELECT player,coins FROM players').fetchall())
print('DEMO OK')
