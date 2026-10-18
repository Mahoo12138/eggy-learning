import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import subprocess
subprocess.run(['./build/unit'],check=True)
from harness import *
import concurrent.futures
import threading
FRAMED=False
SERVICE=False

def test_network():
    with stack(service=SERVICE) as (port,db):
        assert rpc(port,'PING|alice',framed=FRAMED)=='OK|PONG|alice'
        assert rpc(port,'PING|bad name',framed=FRAMED)=='ERR|BAD_REQUEST'
        assert command(['./build/client',str(port),'PING|client'])=='OK|PONG|client'


test_network()
print('PASS network')
print('ALL TESTS PASSED (1 groups)')
