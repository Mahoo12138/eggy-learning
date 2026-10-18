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


def test_deadline():
    with stack(service=SERVICE) as (port,db):
        # Close halfway through a header and verify a later healthy connection survives.
        with socket.create_connection(('127.0.0.1',port),timeout=3) as broken: broken.sendall(b'\x00\x00')
        assert rpc(port,'PING|after_disconnect')=='OK|PONG|after_disconnect'
        with socket.create_connection(('127.0.0.1',port),timeout=3) as slow:
            slow.settimeout(3); slow.sendall(struct.pack('!I',20)+b'P')
            start_time=time.monotonic()
            assert slow.recv(1)==b''
            assert .3<time.monotonic()-start_time<2.5
        assert rpc(port,'PING|after_timeout')=='OK|PONG|after_timeout'
    # The real client is retried against an adversarial peer that never replies.
    listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(); listener.settimeout(4)
    attempts=[]
    def silent_peer():
        try:
            for _ in range(2):
                connection,_=listener.accept(); attempts.append(connection)
                connection.settimeout(3)
                try:
                    while connection.recv(4096): pass
                except (TimeoutError,OSError): pass
                connection.close()
        finally: listener.close()
    thread=threading.Thread(target=silent_peer); thread.start()
    began=time.monotonic()
    result=subprocess.run(['./build/client',str(listener.getsockname()[1]),'PING|retry','1'],cwd=ROOT,text=True,capture_output=True,timeout=4)
    thread.join(timeout=4)
    assert not thread.is_alive()
    assert result.returncode==3 and len(attempts)==2 and time.monotonic()-began<3.5


def test_concurrency():
    with stack(service=SERVICE) as (port,db):
        with socket.create_connection(('127.0.0.1',port),timeout=3) as slow:
            slow.sendall(b'\x00')
            began=time.monotonic()
            assert rpc(port,'PING|fast')=='OK|PONG|fast'
            assert time.monotonic()-began<.8
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as workers:
            outputs=list(workers.map(lambda i:rpc(port,'PING|p'+str(i)),range(24)))
        assert outputs==['OK|PONG|p'+str(i) for i in range(24)]
        stalled=[]
        try:
            for _ in range(20):
                try:
                    connection=socket.create_connection(('127.0.0.1',port),timeout=2)
                    connection.sendall(b'\x00'); stalled.append(connection)
                except OSError: pass
            # Every accepted connection has one fixed lifetime, including queue wait.
            for connection in stalled:
                connection.settimeout(2.5)
                try: assert connection.recv(1)==b''
                except ConnectionResetError: pass
        finally:
            for connection in stalled: connection.close()
        assert rpc(port,'PING|recovered')=='OK|PONG|recovered'


test_network()
print('PASS network')
test_framing()
print('PASS framing')
test_deadline()
print('PASS deadline')
test_concurrency()
print('PASS concurrency')
print('ALL TESTS PASSED (4 groups)')
