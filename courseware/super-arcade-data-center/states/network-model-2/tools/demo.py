import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
DEMO_PLAYER = "alice"
DEMO_AMOUNT = 5
from harness import *
with stack() as (port,db):
    print(rpc(port,'PING|'+DEMO_PLAYER,framed=False))
print('DEMO OK')
