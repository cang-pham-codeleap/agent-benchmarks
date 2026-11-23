# Feature Specification: User-Defined Eval Augments and Combos

**Feature Branch**: `003-user-eval-config`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "The repo covers fixed tests, the rtk and caveman tools, and real-task tests. Each user may have different tools installed: employee A compares Claude with rtk + codegraph, employee B compares Claude with PTC + context-mode (not shipped in the repo). Let each user define their own tools and test combos without depending on this repo. We provide the framework; users configure their own agents to evaluate as dynamically as possible." Design decisions: see `handoff-brief.md`.

## Clarifications

### Session 2026-11-22

- Q: Can a user load a combo that has problems (unknown augment, uninstalled harness, missing task) into the form? → A: Yes. The card stays clickable with a warning and the reason; loading drops the elements that do not exist (unknown augments and tasks, setups whose harness is not installed), tells the user what was dropped, and fills the rest.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add an augment the repository does not ship (Priority: P1)

A user has a tool installed that the benchmark does not know about (for example a context-mode MCP server). They describe how to attach it to a harness in one file inside their own config directory, reload the Evaluating page, and select it on a setup like any built-in augment.

**Why this priority**: This is the core ask. Without it every new tool requires a repository change and a pull request.

**Independent Test**: Put a valid augment file into an empty user config directory, open the Evaluating form, confirm the augment is listed and selectable for its harness, run a smoke benchmark with it, and confirm the run's agent received the declared arguments, environment, files, and MCP servers.

**Acceptance Scenarios**:

1. **Given** a valid augment file in the user augments directory, **When** the user reloads the Evaluating form, **Then** the augment appears for each harness it declares a recipe for, marked as a user augment, without restarting the server.
2. **Given** a user augment with the same id as a bundled augment, **When** the catalog loads, **Then** only the user definition is offered and used, in full, for every harness.
3. **Given** a malformed augment file, **When** the catalog loads, **Then** that augment is listed as unavailable with a problem naming the invalid field, and every other augment still loads.
4. **Given** a user augment whose required binary is not on PATH or whose companion file is missing, **When** the catalog loads, **Then** it is listed as unavailable with that reason, as for built-in augments today.
5. **Given** a run started with a user augment, **When** the user edits or deletes that augment file while the run is in progress, **Then** the run keeps executing the definition captured at start.

---

### User Story 2 - Save and reuse a comparison combo (Priority: P2)

A user builds a comparison in the Evaluating form (several setups with different augments, a task selection, trial count, wall time), saves it under a name, and later loads it with one click to rerun or tweak.

**Why this priority**: Rebuilding the same multi-setup comparison by hand each time is slow and error-prone; saved combos make per-user comparisons repeatable.

**Independent Test**: Configure a form, save it as a combo, reload the page, click the combo card, and confirm the form is restored exactly; confirm the combo file exists in the user config directory.

**Acceptance Scenarios**:

1. **Given** a filled Evaluating form, **When** the user chooses "Save as combo…" and enters a valid id and label, **Then** a combo file is written to the user combos directory and a card for it appears above the setups.
2. **Given** a combo id that already exists, **When** the user saves, **Then** the user is asked to confirm overwrite, and nothing is written unless they confirm.
3. **Given** an id containing characters outside lowercase letters, digits, and hyphens, or longer than 64 characters, **When** the user saves, **Then** the save is rejected with a clear message.
4. **Given** a saved combo, **When** the user clicks its card, **Then** setups, tasks, trials, and wall time are filled from the combo and the preset becomes Custom; the user can still edit before starting.
5. **Given** a combo that references an unknown augment, an uninstalled harness, or a missing task, **When** the catalog loads, **Then** its card shows a warning with the reason and stays clickable; **When** the user clicks it, **Then** the form is filled without those elements and a message lists what was dropped.
6. **Given** no combos exist, **When** the form renders, **Then** no combos row is shown.

---

### User Story 3 - Keep a personal or team config outside the archive directory (Priority: P3)

A user points the benchmark at a config directory of their choice (for example a team git repository of shared augments and combos) without moving their archive.

**Why this priority**: Enables sharing combos and augments between colleagues; the default location already works for a single user.

**Independent Test**: Set the config directory override to a scratch directory containing one augment and one combo, start the server, and confirm both load from there and that saving a combo writes there.

**Acceptance Scenarios**:

1. **Given** the override is set, **When** the catalog loads, **Then** user augments and combos are read only from the override directory, and the catalog reports that directory.
2. **Given** the override is not set, **When** the catalog loads, **Then** the `evals` directory next to the archive is used.

---

### User Story 4 - Know when pooled verdicts mix different recipes (Priority: P3)

A user tunes an augment over several runs. The augment verdict that pools those runs warns when the pooled runs used different versions of the augment definition.

**Why this priority**: Prevents silent mis-reading of verdicts after editing a recipe, without fragmenting history.

**Independent Test**: Run the same augmented setup twice with an edited augment file in between and confirm the pooled verdict shows a drift warning while its numbers are unchanged.

**Acceptance Scenarios**:

1. **Given** pooled runs whose captured augment definitions differ, **When** verdicts are shown, **Then** the verdict carries a drift warning.
2. **Given** pooled runs with identical captured definitions, **When** verdicts are shown, **Then** no warning appears.
3. **Given** runs recorded before this feature (no captured definition), **When** they are pooled, **Then** they are treated as using the bundled definition.

### Edge Cases

- Augment file with an unknown harness key, unknown `kind`, or wrong value types: unavailable with a problem; not a crash.
- Augment file that is not valid JSON or is empty: unavailable with a parse problem.
- Companion file path escaping the augment's directory via `..`: rejected as a problem.
- User augment directory or combos directory missing: treated as empty; no error.
- Config root does not exist when saving a combo: it is created.
- Two prompt-mode augments in one setup from a combo: the existing "at most one prompt-mode augment per setup" rule rejects the setup at run start and the combo shows the reason.
- A combo with more setups or trials than the current limits: shown unavailable with the limit as reason; saving such a combo is rejected.
- A combo whose augment is valid but unavailable on this machine (binary missing): card loads into the form; the augment checkbox stays disabled with its reason, matching current form behaviour.
- Concurrent save of the same combo id: last confirmed write wins; the file is never left partially written.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST load augment definitions from the bundled augments directory and then the user augments directory, using one loader and one validator for both.
- **FR-002**: The six currently built-in augments MUST be provided as bundled definition files and MUST resolve to the same arguments, environment, companion files, MCP servers, added tools, and prepare steps as before this change.
- **FR-003**: A user augment whose id equals a bundled augment id MUST replace the bundled definition entirely.
- **FR-004**: Each augment in the catalog MUST report its source (bundled or user).
- **FR-005**: An invalid augment file MUST appear as unavailable with a problem message that names the offending field or parse error; it MUST NOT prevent other augments from loading.
- **FR-006**: Companion file sources in a user augment MUST resolve relative to that augment's directory or the user's home directory, and MUST NOT resolve outside them via relative path segments.
- **FR-007**: The catalog MUST reflect changes to augment and combo files on the next catalog request without a server restart.
- **FR-008**: The user config root MUST be the directory named by `AGENT_BENCHMARKS_EVAL_DIR` when set, otherwise the `evals` directory next to the archive; the catalog MUST report the resolved root.
- **FR-009**: When a run starts, the system MUST capture the full definitions of every augment the run uses into the run's manifest, and the run MUST execute from that capture.
- **FR-010**: Runs whose manifest has no captured definitions MUST be interpreted with the bundled definitions.
- **FR-011**: Augment verdicts that pool runs with differing captured definitions MUST carry a drift flag displayed as a warning; verdict computation MUST otherwise be unchanged.
- **FR-012**: The setup identity used to label and pool runs MUST stay unchanged.
- **FR-013**: The system MUST load combos from the user combos directory and expose each with its label, setups, tasks, trials, wall time, availability, and problem.
- **FR-014**: Combo validation MUST reuse the same rules as starting a benchmark run (harness installed, config supported, augments known and supported, prompt-mode limit, setup and trial limits, tasks present).
- **FR-015**: Users MUST be able to save the current form as a combo with an id of 1–64 lowercase letters, digits, or hyphens and a label; an existing id MUST require explicit overwrite.
- **FR-016**: Combo files MUST be written atomically.
- **FR-017**: Loading a combo MUST fill setups, tasks, trials, and wall time in the form and set the preset to Custom. Elements that do not exist on this machine (unknown augments, unknown tasks, setups whose harness is not installed) MUST be dropped on load, and the form MUST list what was dropped.
- **FR-018**: The local API contract and its documentation MUST describe the new catalog fields and the combo save route.
- **FR-019**: No outbound network calls may be added.

### Key Entities

- **Augment definition**: A named way to attach a tool to one or more harnesses: label, kind (shell-proxy, MCP, prompt-mode, harness-flag), description, source URL, required binary, and per-harness recipes (arguments, environment, companion files, MCP servers, added tools, prepare step). Source is bundled or user.
- **Combo**: A saved benchmark input: id, label, setups (harness, model, config, augments), task ids, trials, wall time. Availability and problem are derived, not stored.
- **User config root**: The directory holding user augments and combos.
- **Augment snapshot**: The captured augment definitions stored with a run, used for execution and drift detection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can add a new tool to their benchmarks by creating one file (plus optional companion files) and reloading the page, with zero changes to the repository.
- **SC-002**: A saved combo restores 100% of its setups, tasks, trials, and wall time when loaded.
- **SC-003**: Recreating a previously used multi-setup comparison takes one click instead of re-entering every setup.
- **SC-004**: All six previously built-in augments produce identical agent invocations before and after the change.
- **SC-005**: A malformed user file never prevents the Evaluating page from loading; 100% of invalid files show a reason.
- **SC-006**: Editing an augment mid-run changes 0 invocations of that run.

## Assumptions

- Users write augment files by hand; the documentation provides the format and worked examples (context-mode, overriding `ptc` for Claude).
- Users trust their own config directory; augment recipes may run commands (hooks, prepare steps) on the local machine exactly as built-in augments do today.
- Task definitions continue to come from the existing task locations; this feature does not move them.
- Only benchmark runs use combos; real-task runs are unchanged.
- No archive schema migration is expected because augment ids are already stored as text in run manifests; to be confirmed during planning.
