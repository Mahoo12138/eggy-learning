import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
DEMO_PLAYER = "alice"
DEMO_AMOUNT = 5
import subprocess
subprocess.run(['./build/client','PING|'+DEMO_PLAYER],check=True)
print('DEMO OK')
