```doc-meta
role: contract
lifecycle: active
```

# Working in fantasy-assistant

This is a personal Sleeper draft assistant. The accepted decision is
[ADR 0001](docs/adr/0001-local-draft-assistant.md); each implementation bead
contains its exact file footprint, behavior and test contract.

For the current Fantasy experiment, every coordinator, leader, worker,
reviewer and helper must use `gpt-6-astra` with `xhigh` reasoning effort and
Fast mode disabled (`service_tier=default`). Apply these settings explicitly
to launches and verify active sessions; do not substitute a cheaper model,
lower effort or a different provider automatically. This operator instruction
supersedes the experiment's earlier medium-effort default and any differing
model-selection guidance for this run. Preserve the experiment's existing
delegation, workspace and approval controls. Record work performed before the
setting change honestly; changing a prompt alone does not prove the runtime
model or effort changed.

All work goes through `br`. Start with `br ready`, read `br show <id>`,
and claim with `br update <id> --claim`. The description is the execution
contract. Capture incidental discoveries with `jot` (include file, symptom
and reproduction for defects). A verified defect blocking current work gets
an immediate bead; do not create backlog items reflexively for discoveries.
Do not run jot-review automatically.

Every code change requires test-first unit AND real-composition integration
tests. Write assertions, demonstrate red, implement, demonstrate green.
Integration uses actual HTTP/filesystem/browser composition, not mocked
storage. The planned full command is `npm test`, covering tests/unit and
tests/integration, including Chromium. Full wall-clock budget is 30 seconds;
new test costs remain estimates until measured. No skipped/skeleton test counts
as completion. Documentation-only changes may use [no-test] with justification.

Use an isolated worktree per agent. Read and honor requirements-directed
dependencies: `br dep add B A` means B needs A. Shared write footprints require
serial work or one lane; a group tag does not assert automatic bundling.
After renaming/deleting symbols, search all consumers before closure.

Keep raw provider files and runtime state in Git-ignored .local/. All Sleeper
operations are GET-only. No automatic picks or transactions, paid dependency,
public dataset publication, or season-management scope is authorized by the
initial draft release.

Before closing work, run relevant targeted tests and the full suite, inspect
all errors/warnings, and capture discoveries. Run `br lint --status all`,
`docs-doctor --repo . --json` for changed documents, and `git diff --check`.
Update/close beads only after verification. Commit tracker state with the work,
pull with rebase, push, and verify the branch is clean and up to date. Follow
the executing lane's existing branch/PR contract; do not overwrite others'
work or clear stashes you do not own.

Planning is complete only when its durable contract and executable backlog
are published. Application implementation and the human ten-second rehearsal
metric must be reported separately from planning completion.
