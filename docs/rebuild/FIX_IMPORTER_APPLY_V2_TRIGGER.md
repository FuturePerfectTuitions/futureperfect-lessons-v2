# Importer source patch V2 trigger

The first harness was rejected before execution because embedded multiline Python broke workflow YAML indentation. This trigger uses the same exact source patch logic from a standalone script, then runs the complete importer/email regression suite and commits only on PASS.
