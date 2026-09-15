# D1 Assignment Final Observer Trigger

Run the independent final read-only observer after the successful guarded production repair.

The observer must perform no production mutation. It must independently confirm:

- all 25 authoritative current memberships exactly match D1;
- zero missing, extra or date/window-mismatched assignments;
- zero roster-backed entitlement defects;
- zero current semantic under-entitlement rows;
- rebuilt Student still has no direct `student_batch_assignments` dependency;
- public Browser → Student topology is unchanged;
- Browser, Student and retained legacy active versions are unchanged from the successful repair evidence.
