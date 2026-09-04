#!/usr/bin/env python3
import runpy
from pathlib import Path

source = Path("scripts/r2_drive_y4_full_preflight.py").read_text(encoding="utf-8")
repls = [
    ('ENGLISH_FOLDER_ID = "1OYFPtGBb9Io7dwiuIvdMYsvJnb2TczXb"','ENGLISH_FOLDER_ID = "1OBgXw-OmLuEZGkf0N8OjPKemHYzPk5ww"'),
    ('MATHS_FOLDER_ID = "1OzjeIf6BaFqEL8dCleM9ad3K-A1WtONw"','MATHS_FOLDER_ID = "1Ou-XT-wUFxEgUJ2N0Ojq5P67z4s-HkWy"'),
    ('ORDINARY_RANGES = {1: range(1, 11), 2: range(11, 24), 3: range(24, 35)}','ORDINARY_RANGES = {1: range(1, 10), 2: range(10, 20), 3: range(20, 32)}'),
    ('MATHS_RANGES = {1: range(1, 14), 2: range(14, 23), 3: range(23, 37)}','MATHS_RANGES = {1: range(1, 17), 2: range(17, 31), 3: range(31, 44)}'),
    ('"exact_current_code_required_outside_vr": True,','"exact_current_code_required_everywhere": True,'),
    ('"vr_subtree_historical_code_exception": True,','"vr_subtree_historical_code_exception": False,'),
]
for old,new in repls:
    if old not in source:
        raise RuntimeError(f"Expected Year 4 template fragment not found: {old}")
    source = source.replace(old,new,1)
old = '    if not ee_seen:\n        raise RuntimeError("No current Year 4 EE 11+ lesson folders discovered")\n'
if old not in source:
    raise RuntimeError("Expected Year 4 EE requirement block not found")
source = source.replace(old,'    # Year 6 has no separate authoritative EE lesson-folder namespace.\n',1)
# Year 6 does NOT inherit the Year 4/5 historical-code VR exception.
old = '            if not vr and not exact_code_prefix(item["name"], code):\n'
if old not in source:
    raise RuntimeError("Expected Year 4 VR filename-exception condition not found")
source = source.replace(old,'            if not exact_code_prefix(item["name"], code):\n',1)
source = source.replace('"NON_CURRENT_CODE_OUTSIDE_VR"','"NON_CURRENT_CODE"')
source = source.replace('NONCURRENT_OUTSIDE_VR','NONCURRENT')
source = source.replace('Y4','Y6').replace('y4','y6').replace('L1T','L3T').replace('year4','year6')
tmp = Path('/tmp/r2_drive_y6_full_preflight_runtime.py')
tmp.write_text(source,encoding='utf-8')
ctx = runpy.run_path(str(tmp),run_name='__main__')
for k,v in ctx.items():
    if not k.startswith('__'):
        globals()[k]=v
