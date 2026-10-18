import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import subprocess
subprocess.run(['./build/unit'],check=True)

print('ALL TESTS PASSED (0 groups)')
