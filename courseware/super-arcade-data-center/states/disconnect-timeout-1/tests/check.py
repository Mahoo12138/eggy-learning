import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import subprocess
subprocess.run(['./build/unit'],check=True)
from harness import *
import concurrent.futures
import threading
FRAMED=True
SERVICE=False

def test_network():
    with stack(service=SERVICE) as (port,db):
        assert rpc(port,'PING|alice',framed=FRAMED)=='OK|PONG|alice'
        assert rpc(port,'PING|bad name',framed=FRAMED)=='ERR|BAD_REQUEST'
        assert command(['./build/client',str(port),'PING|client'])=='OK|PONG|client'


def test_framing():
    with stack(service=SERVICE) as (port,db):
        with socket.create_connection(('127.0.0.1',port),timeout=3) as connection:
            connection.settimeout(3)
            encoded=frame('PING|fragment')
            for byte in encoded: connection.sendall(bytes([byte]))
            assert response(connection)=='OK|PONG|fragment'
            connection.sendall(frame('PING|one')+frame('PING|two'))
            assert response(connection)=='OK|PONG|one'
            assert response(connection)=='OK|PONG|two'
        for length in (0,4097,0xffffffff):
            with socket.create_connection(('127.0.0.1',port),timeout=3) as connection:
                connection.settimeout(3); connection.sendall(struct.pack('!I',length))
                assert connection.recv(1)==b''
        with socket.create_connection(('127.0.0.1',port),timeout=3) as connection:
            connection.settimeout(3); connection.sendall(frame(b'PING|a\0b'))
            assert connection.recv(1)==b''


test_network()
print('PASS network')
test_framing()
print('PASS framing')
print('ALL TESTS PASSED (2 groups)')
