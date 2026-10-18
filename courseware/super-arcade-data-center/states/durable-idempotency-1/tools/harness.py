
"""Real processes and TCP helpers; every child is reaped and every test has deadlines."""
import contextlib
import os
from pathlib import Path
import select
import socket
import struct
import subprocess
import tempfile
import time
ROOT=Path(__file__).resolve().parents[1]

def command(arguments,expected=0,timeout=6,env=None):
    result=subprocess.run(arguments,cwd=ROOT,text=True,capture_output=True,timeout=timeout,env=env)
    if result.returncode!=expected:
        raise AssertionError(f'{arguments}: exit {result.returncode}\n{result.stdout}\n{result.stderr}')
    return result.stdout.strip()

def start(arguments,extra_env=None):
    env=os.environ.copy(); env.update(extra_env or {})
    process=subprocess.Popen(arguments,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
    ready,_,_=select.select([process.stdout],[],[],4)
    if not ready:
        process.kill(); out,err=process.communicate(); raise AssertionError(f'process not ready: {arguments}\n{out}\n{err}')
    line=process.stdout.readline().strip()
    if '_READY=' not in line:
        process.kill(); out,err=process.communicate(); raise AssertionError(f'bad ready line {line}\n{out}\n{err}')
    return process,int(line.split('=',1)[1])

def stop(process):
    if process.poll() is None: process.terminate()
    try: out,err=process.communicate(timeout=4)
    except subprocess.TimeoutExpired:
        process.kill(); out,err=process.communicate(); raise AssertionError(f'process did not stop within deadline\n{out}\n{err}')
    if process.returncode!=0: raise AssertionError(f'process exit={process.returncode}\n{out}\n{err}')

@contextlib.contextmanager
def stack(service=False,db=None,env=None):
    with tempfile.TemporaryDirectory(prefix='arcade-') as temporary:
        database=Path(db) if db else Path(temporary)/'arcade.db'
        service_process=None; gateway_process=None
        try:
            if service: service_process,service_port=start(['./build/service',str(database),'0'],env)
            args=['./build/gateway','0']+([str(service_port)] if service else [])
            gateway_process,gateway_port=start(args)
            yield gateway_port,database
        finally:
            try:
                if gateway_process: stop(gateway_process)
            finally:
                if service_process: stop(service_process)

def frame(body):
    if isinstance(body,str): body=body.encode()
    return struct.pack('!I',len(body))+body

def exact(connection,size):
    parts=[]
    while size:
        part=connection.recv(size)
        if not part: raise EOFError('connection closed before complete frame')
        parts.append(part); size-=len(part)
    return b''.join(parts)

def response(connection):
    size=struct.unpack('!I',exact(connection,4))[0]
    assert 0<size<=4096,size
    return exact(connection,size).decode()

def rpc(port,body,framed=True):
    with socket.create_connection(('127.0.0.1',port),timeout=3) as connection:
        connection.settimeout(3)
        if framed:
            connection.sendall(frame(body)); return response(connection)
        connection.sendall(body.encode()); connection.shutdown(socket.SHUT_WR)
        chunks=[]
        while True:
            block=connection.recv(4096)
            if not block: break
            chunks.append(block)
        return b''.join(chunks).decode()
