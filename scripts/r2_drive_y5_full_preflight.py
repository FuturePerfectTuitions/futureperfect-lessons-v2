#!/usr/bin/env python3
import runpy
from pathlib import Path

source = Path("scripts/r2_drive_y4_full_preflight.py").read_text(encoding="utf-8")
repls = [
    ('ENGLISH_FOLDER_ID = "1OYFPtGBb9Io7dwiuIvdMYsvJnb2TczXb"','ENGLISH_FOLDER_ID = "1OKpYKW8gBxBijwFqfYQ5LwF9xp4-Eiwa"'),
    ('MATHS_FOLDER_ID = "1OzjeIf6BaFqEL8dCleM9ad3K-A1WtONw"','MATHS_FOLDER_ID = "1OvQmVd3Xlq_nUMQRyJdUQxKbuHy1gogA"'),
    ('ORDINARY_RANGES = {1: range(1, 11), 2: range(11, 24), 3: range(24, 35)}','ORDINARY_RANGES = {1: range(1, 11), 2: range(11, 21), 3: range(21, 37)}'),
    ('MATHS_RANGES = {1: range(1, 14), 2: range(14, 23), 3: range(23, 37)}','MATHS_RANGES = {1: range(1, 13), 2: range(13, 26), 3: range(26, 39)}'),
]
for old,new in repls:
    if old not in source:
        raise RuntimeError(f"Expected Year 4 template fragment not found: {old}")
    source = source.replace(old,new,1)
old = '    if not ee_seen:\n        raise RuntimeError("No current Year 4 EE 11+ lesson folders discovered")\n'
if old not in source:
    raise RuntimeError("Expected Year 4 EE requirement block not found")
source = source.replace(old,'    # Year 5 has no separate authoritative EE lesson-folder namespace.\n',1)
source = source.replace('Y4','Y5').replace('y4','y5').replace('L1T','L2T').replace('year4','year5')
# Keep the no-EE comment after global replacement harmlessly transformed.
tmp = Path('/tmp/r2_drive_y5_full_preflight_runtime.py')
tmp.write_text(source,encoding='utf-8')
ctx = runpy.run_path(str(tmp),run_name='__main__')
# expose template globals/functions for apply and final verifier
for k,v in ctx.items():
    if not k.startswith('__'):
        globals()[k]=v
