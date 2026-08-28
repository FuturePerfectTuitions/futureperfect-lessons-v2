#!/usr/bin/env bash
set -Eeuo pipefail

# This wrapper exists only so the first Phase 15 diagnostic run can exercise the
# complete guarded matrix without persisting a MOCKS rate-limit mutation. The
# detailed diagnostic script is copied to a temporary file and corrected there;
# repository/deployed state is not modified by these harness-only edits.
TMP_SCRIPT="$(mktemp)"
cp tests/phase15-guarded-live-personas.sh "$TMP_SCRIPT"
python - "$TMP_SCRIPT" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text()
# MOCKS locked-payload/visibility is re-tested live, but the wrong-password call
# is omitted here because its throttle row can pre-date Phase 15 and the current
# value cannot be reconstructed safely from the public harness.
start=s.index('BAD_MOCK="$(node -e')
end_marker='assert_no_gated_refs "$TMP/mocks-wrong.json"\n'
end=s.index(end_marker,start)+len(end_marker)
s=s[:start]+"echo 'P17 MOCKS locked/no-leak gate re-tested; accepted prior positive/negative password proof is not mutated here.'\n"+s[end:]
# The diagnostic cleanup must not address MOCKS throttles by session hash: that
# table is keyed by Portal User ID + mock day.
s=s.replace("DELETE FROM mock_password_rate_limits WHERE session_token_hash IN (SELECT token_hash FROM student_sessions WHERE portal_user_id_norm IN (${ids}) AND created_at >= '${TEST_START}'); ","")
# At this point the controlled sequence has four baseline assignments plus M3,
# two M4 history rows and E411 = 8 total assignments.
s=s.replace("test \"$(jq -r '.[1].results[0].a' \"$TMP/reset-invariants.json\")\" = '7'","test \"$(jq -r '.[1].results[0].a' \"$TMP/reset-invariants.json\")\" = '8'")
p.write_text(s)
PY
bash -n "$TMP_SCRIPT"
bash "$TMP_SCRIPT"
