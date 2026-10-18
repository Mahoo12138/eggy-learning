
"""Start the final local system with a persistent database; stop with Ctrl-C."""
import argparse
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parent))
from harness import start,stop
parser=argparse.ArgumentParser()
parser.add_argument('--db',default='arcade.db')
args=parser.parse_args()
service=None; gateway=None
try:
    service,service_port=start(['./build/service',str(Path(args.db).resolve()),'0'])
    gateway,gateway_port=start(['./build/gateway','0',str(service_port)])
    print(f'Gateway port: {gateway_port}',flush=True)
    print(f"./build/client {gateway_port} 'ADD|event_001|alice|10' 1",flush=True)
    while service.poll() is None and gateway.poll() is None: time.sleep(.2)
    raise RuntimeError('a child process exited unexpectedly')
except KeyboardInterrupt: pass
finally:
    try:
        if gateway: stop(gateway)
    finally:
        if service: stop(service)
