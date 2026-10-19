# Capability Graph rebuild

This is a new implementation governed by the confirmed requirements v3.1 and Usage Contract v1.4. Do not use old source, tests, configuration, examples or architecture as implementation references. Historical `changelogs/` files are read-only.

Develop directly on `main`, as requested by the user. Do not create feature branches or worktrees, or rewrite history. Do not publish a package or push changes without authorization. Release automation runs from version tags; never create or push a release tag merely to test the workflow.

The handoff and execution checkpoint are outside this repository at `/workspace/capability-graph-rebuild-20261019/`. Read `reports/RESUME.md` and the confirmed handoff baselines before continuing. Do not copy the handoff PoC stubs into product code.

Gate 0 cleanup was verified before this scaffold was written: only `.git/` and `changelogs/` remained; 280 old tracked files were removed and five changelog hashes were preserved. Do not repeat destructive cleanup against new files.

Gate A must retain real MCP, model isolation/authentication, AJV and package evidence. PASS, FAIL and BLOCKED are distinct. A blocked model or host test is not a passing gate. Plan each gate before implementation and keep exact commands, versions, results and remaining risks in the external evidence directory.

All product implementation and formal tests must be authored from scratch. Do not add RAG, embeddings, keyword matching, databases, agent runtimes or capability execution. Public API and behavior changes require a user decision; ordinary internal design and test corrections do not.

Keep temporary installations, generated validation builds, backups, logs and reports outside the source tree. New permanent source, tests, user documentation and CI belong here. Installation must never change host configuration or register plugins automatically.
