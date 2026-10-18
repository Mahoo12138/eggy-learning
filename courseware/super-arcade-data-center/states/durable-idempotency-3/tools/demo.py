import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
DEMO_PLAYER = "alice"
DEMO_AMOUNT = 5
from harness import *
with tempfile.TemporaryDirectory(prefix='demo-') as temporary:
    database=Path(temporary)/'demo.db'
    with stack(service=True,db=database,env={'ARCADE_TEST_DROP_ACK_ONCE':'demo_add'}) as (port,db):
        print(command(['./build/client',str(port),f'ADD|demo_add|{DEMO_PLAYER}|{DEMO_AMOUNT}' ,'1']))
        print(rpc(port,'BALANCE|'+DEMO_PLAYER))
        print(rpc(port,f'REDEEM|demo_buy|{DEMO_PLAYER}|2'))
        print(rpc(port,f'REDEEM|demo_denied|{DEMO_PLAYER}|999'))
        print(rpc(port,f'ADD|demo_add|{DEMO_PLAYER}|{DEMO_AMOUNT}'))
        print(rpc(port,f'ADD|demo_add|{DEMO_PLAYER}|{DEMO_AMOUNT+1}'))
print('DEMO OK')
