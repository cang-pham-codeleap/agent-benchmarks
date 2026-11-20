# Feature Specification: Real-Task Evaluations

**Feature Branch**: `001-real-task-evals`

**Created**: 2026-11-20

**Status**: Draft

**Input**: Handoff brief from brainstorming (`specs/001-real-task-evals/handoff-brief.md`): run real coding tasks — a free prompt or a replayed merged commit — on the user's own repository across chosen harness × model × configuration combos, and present objective, side-by-side results that reviewers can compare with their daily work and share as a report.

## Clarifications

### Session 2026-11-20

- Q: Which harnesses can run in "default" configuration? → A: Claude Code (needs `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` in the environment, since a clean config directory cannot read a keychain login) and Codex (a clean home with only the auth file copied). For other harnesses the "default" option is disabled with the reason shown.
- Q: How are a replay's hidden tests run and counted? → A: With a per-repository hidden-test command containing a `{file}` placeholder, run once per hidden test file; the count is files passed over files total. The command is prefilled from the repository's tooling and editable.
- Q: How do combos get dependencies (for example `node_modules`) in their isolated copy? → A: An optional per-repository setup command (prefilled from the lockfile, e.g. `bun install --frozen-lockfile`) runs in each combo's copy before the agent starts.
- Q: Does the benchmark section get the configuration choice too? → A: No. Benchmark runs always use "current configuration"; the choice exists only in the real-task form.
- Q: Do the repository's own instruction files (e.g. its `AGENTS.md`) count as user configuration? → A: No. They are part of the repository under test and load in both modes; "default" removes only the user's personal, global setup.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Replay a merged commit across combos (Priority: P1)

A developer picks one of their repository's merged commits (for example a bug fix with tests). The system rewinds a private copy of the repository to just before that commit, hides the commit's test files, and gives each selected combo (harness × model × configuration) the commit's description as the task. When every combo finishes, the commit's own tests are applied and run against each result. The developer sees, per combo, whether the original tests pass, how its change compares in size and files touched to the human's actual change, and what it cost in time and money.

**Why this priority**: It is the only real-task source with an objective answer key written by a human on the user's own code, so its results are comparable, repeatable, and directly relatable to daily work.

**Independent Test**: Run a replay of a known commit on a small repository with one combo; confirm the agent never sees the hidden tests, the tests are run afterward, and the results row and human reference row appear.

**Acceptance Scenarios**:

1. **Given** a repository with a merged commit X that changed code and tests, **When** the user starts a replay of X with two combos, **Then** each combo starts from the state just before X without X's test files, and after it finishes X's test files are applied and their pass count is recorded for that combo.
2. **Given** a finished replay run, **When** the user opens its results, **Then** a reference row describing the human change (files, lines added/removed, checks) appears alongside the combo rows, and each combo shows the share of the human's files it also touched and its change size relative to the human's.
3. **Given** a finished replay run, **When** the user inspects the user's own repository, **Then** it is unchanged: no new branches or refs, no modified or added files.

---

### User Story 2 - Run a free prompt across combos (Priority: P1)

A developer chooses a repository and a starting branch or commit, types a prompt exactly as they would in daily work, chooses combos, and starts the run. Each combo works on its own isolated copy. Afterwards the developer sees each combo's change, the results of the repository's usual check commands (tests, type check, lint, build), and time and cost.

**Why this priority**: It is how developers actually use agents day to day; it has no answer key but gives the "this is my real work" comparison reviewers asked for.

**Independent Test**: Run one prompt on a small repository with one combo and one check command; confirm the change, the check result with its log, and the cost/time metrics appear.

**Acceptance Scenarios**:

1. **Given** a repository and a prompt, **When** the user starts a run with three combos, **Then** each combo works on a separate copy and cannot see the others' edits.
2. **Given** check commands configured for the repository, **When** a combo finishes, **Then** each check's pass/fail, duration, and log are recorded for that combo, and a failing check does not hide the combo's other results.
3. **Given** the user ran a prompt run on a repository before, **When** they start another run on the same repository, **Then** the previously used check commands are prefilled.

---

### User Story 3 - Compare current configuration against harness defaults (Priority: P2)

For each harness × model row the user ticks "current configuration", "default", or both. "Current configuration" means the harness runs with the user's everyday setup (instructions files, skills, tool servers, settings). "Default" means the harness runs with none of the user's customizations. Ticking both produces two combos in the same run so the user can see whether their setup helps.

**Why this priority**: "Does my setup make the agent better?" is a key question reviewers want answered, but it builds on stories 1 and 2.

**Independent Test**: Run one task with one harness × model with both boxes ticked; confirm two distinct result rows, and that the default row's session shows none of the user's instructions or skills were loaded.

**Acceptance Scenarios**:

1. **Given** both boxes ticked for one harness × model, **When** the run starts, **Then** two combos are scheduled and reported as separate rows, labeled with their configuration.
2. **Given** a "default" combo whose harness cannot sign in without the user's configuration, **When** the run reaches that combo, **Then** it is reported as unavailable with the reason, excluded from pass rates, and never silently run with the user's configuration instead.

---

### User Story 4 - Review results side by side (Priority: P2)

A reviewer opens a finished run. A summary table lists every combo (and, for replays, the human reference) with outcome, hidden-test result, checks, change size, overlap with the human change, time, tokens, and cost. Below it, the reviewer ticks two or three entries — the human change is ticked by default for replays — to read their changes side by side, and can switch to each combo's transcript or check logs.

**Why this priority**: Without a readable comparison the collected data has no reviewer value; it depends on stories 1–2 producing data.

**Independent Test**: Open a finished run with three combos; tick two plus the human reference and confirm their changes are shown side by side, with transcript and check-log views available per combo.

**Acceptance Scenarios**:

1. **Given** a finished run with multiple combos, **When** the reviewer opens it, **Then** the summary table shows one row per combo with all listed metrics, marking unavailable values explicitly rather than as zero.
2. **Given** the summary table, **When** the reviewer ticks entries, **Then** their changes are shown side by side, file by file.
3. **Given** multiple trials per combo, **When** the reviewer views the summary, **Then** pass rate and the spread of time and cost across trials are shown.

---

### User Story 5 - Export a shareable report (Priority: P3)

The developer exports a finished run as a single file that colleagues can open offline on any machine, containing the run details, the summary table, every combo's change and the human reference, check and hidden-test results, and a transcript summary — but not the full transcripts.

**Why this priority**: Reviewers on other machines need the results, but in-app review covers the primary user first.

**Independent Test**: Export a finished run, open the file with networking disabled, and confirm all sections render and no full transcript text is present.

**Acceptance Scenarios**:

1. **Given** a finished run, **When** the user exports it, **Then** a single file is produced that renders completely offline and loads no external resources.
2. **Given** an exported report, **When** it is inspected, **Then** it contains transcript summaries (turns, tool calls, errors) but no raw transcript text.

---

### Edge Cases

- The repository path is not a git repository, the commit does not exist, or a chosen hidden test path is not part of the commit: the run is rejected before anything is created, with a specific message.
- The user's repository has uncommitted changes: the run proceeds from the committed state; the form states that uncommitted work is not included.
- A combo's preparation step fails (for example the rewind fails): that combo is reported as a setup error and excluded from pass rates; other combos continue.
- A check command hangs: it is stopped at its time limit, recorded as timed out, and the remaining checks still run.
- The session for a combo cannot be found after the run: time, change, and check results still show; cost and tokens show as unavailable with the reason.
- A replayed commit is a merge commit or has no test files: hidden tests are empty, the user is told before starting, and results rely on check commands.
- The run is cancelled or the app restarts mid-run: finished combos keep their results, unfinished ones can be resumed, and no leftover working copies remain for cancelled combos.
- Disk usage: per-combo working copies are removed once their change and logs are saved; the private repository copy stays until the run is deleted.
- Two combos produce identical changes: both are shown; overlap metrics still compute.
- The provider rate-limits a combo: it is reported as provider-limited, excluded from pass rates, and can be retried.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The evaluating area MUST offer a "Real tasks" section, separate from the existing benchmark section, with its own run form and run history.
- **FR-002**: Users MUST be able to choose a local git repository and a task type: free prompt (with a starting branch or commit) or replay commit (with a commit identifier).
- **FR-003**: For replay tasks, the system MUST prefill the prompt from the commit's description, let the user edit it, and propose the commit's test files as hidden tests that the user can deselect.
- **FR-004**: Hidden test files MUST NOT be visible to the agent while it works and MUST be applied only when grading that combo.
- **FR-005**: Users MUST be able to define, per repository, check commands, an optional setup command, and (for replays) a hidden-test command; the system MUST remember them per repository and run each check per combo with its own time limit, recording pass/fail, duration, and log.
- **FR-006**: Users MUST be able to select combos as harness × model × configuration, where configuration is "current configuration" or "default", selectable independently per harness × model row.
- **FR-007**: A "default" combo MUST run without the user's personal global instructions, skills, tool servers, and settings (repository instruction files still apply); it is offered only for harnesses that support it; if it cannot authenticate, it MUST be reported as unavailable with a reason and MUST NOT fall back to the current configuration.
- **FR-008**: The system MUST run every combo on its own isolated copy of the repository and MUST NOT modify the user's repository in any way.
- **FR-009**: For each combo and trial, the system MUST record: outcome, the full change made, change size (files, lines added/removed), check results, hidden-test results (replay), tokens, cost, end-to-end and agent time, number of turns and tool calls.
- **FR-010**: For replay runs, the system MUST record the human change from the commit as a reference and report each combo's share of the human's files it touched and its change size relative to the human's.
- **FR-011**: A combo's outcome MUST count as passed only when the agent finished successfully and, for replays, all hidden tests pass; check results MUST be reported separately and MUST NOT change the outcome.
- **FR-012**: Infrastructure failures (setup errors, unavailable harnesses, provider limits) MUST be shown but excluded from pass rates, consistent with existing benchmark rules.
- **FR-013**: The results view MUST show a summary table of all combos (plus the human reference for replays) and a side-by-side change comparison for user-ticked entries, with the human reference ticked by default for replays.
- **FR-014**: The results view MUST give access to each combo's transcript and check logs.
- **FR-015**: With more than one trial, the summary MUST show pass rate and the spread of time and cost per combo.
- **FR-016**: Users MUST be able to cancel and resume real-task runs with the same guarantees as benchmark runs.
- **FR-017**: Users MUST be able to export a finished run as one self-contained file that renders offline, loads no external resources, and includes transcript summaries but no raw transcript text.
- **FR-018**: Invalid input MUST be rejected before any run data is created, with a message naming the problem.
- **FR-019**: Each run MUST record what it ran: repository and starting commit, prompt, harness versions, and each combo's configuration.
- **FR-020**: Collected results MUST retain full changes and metadata so an automated review step can be added later without changing stored results.
- **FR-021**: The system MUST NOT add any outbound network calls or automated model-based judging of its own.

### Key Entities

- **Real-task run**: one execution of one task on one repository across a set of combos and trials; has repository, starting point, task type, prompt, check commands, combos, trials, time limit, status, and provenance.
- **Task**: either a free prompt with a starting branch/commit, or a replay of a commit with its hidden test files and its human change as reference.
- **Combo**: harness × model × configuration ("current configuration" or "default").
- **Cell result**: one combo × trial attempt; has outcome, change, change size, check results, hidden-test results, tokens, cost, times, turns, tool calls, and link to its session.
- **Human reference**: the original commit's change and its size, used for comparison in replay runs.
- **Repository check profile**: the check commands remembered for a repository.
- **Report**: the exported, self-contained view of one run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can configure and start a replay run of a chosen commit across 4 combos in under 2 minutes from opening the form.
- **SC-002**: In 100% of runs, the user's repository is unchanged after the run (no new refs, no file changes).
- **SC-003**: In 100% of replay cells, hidden test files are absent from the agent's working copy while it works.
- **SC-004**: For every finished cell, the change, change size, and check results are available; cost and tokens are available whenever the harness's session is found, otherwise marked unavailable with a reason.
- **SC-005**: A reviewer can identify, from the summary table alone, which combo passed the original tests at the lowest cost and which made the change closest in size to the human's, without opening any other view.
- **SC-006**: An exported report opens and renders fully on another machine with networking disabled, and contains no raw transcript text.
- **SC-007**: Running the same replay with the same combos twice yields the same human reference and hidden-test set.

## Assumptions

- Users run tasks on repositories on their own machine; remote repositories are cloned by the user beforehand.
- Reviewers evaluate quality in their own tools after reading the metrics and changes; no in-app scoring is provided.
- Ticket sources (issue trackers) and automated model-based judging are out of scope for this version.
- Benchmark runs always use "current configuration"; older benchmark runs without a recorded configuration are shown as "current configuration".
- Hidden tests are detected from the commit by common test-file naming patterns; users can deselect any of them.
- Default time limit per combo is 30 minutes for real tasks (longer than benchmark tasks); the existing per-run combo limit still applies.
- "Default" configuration is supported for Claude Code and Codex in this version; other harnesses show the option disabled.
- The existing trial runner, its run ledger, session syncing, and summary statistics are reused.
