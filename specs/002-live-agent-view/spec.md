# Feature Specification: Live Agent View

**Feature Branch**: `002-live-agent-view`

**Created**: 2026-11-21

**Status**: Draft

**Input**: User description: "The agents are running, but I want a realtime screen to watch how the coding agents are working. Add this feature so I can choose to watch, or choose to watch and compare the setups at the same time." Design brief: `handoff-brief.md`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch the running agent (Priority: P1)

While an evaluation runs, the user opens the Live view and sees what the running agent does, step by step: its messages, each tool it calls with a short summary of the arguments, each tool result (marked when it failed), and its spend so far. New steps appear on their own. When the run moves to the next cell, the view follows it.

**Why this priority**: This is the core ask. Today the user only sees a progress bar and a cell name, so a slow or stuck agent is a black box.

**Independent Test**: Start a run with one setup and two tasks, open Live, and confirm that steps appear while the agent works and that the view switches to the second task when it starts.

**Acceptance Scenarios**:

1. **Given** a run with a running cell, **When** the user opens Live in Watch mode, **Then** the view shows that cell's setup, task, trial, elapsed time, and every step recorded so far, newest at the bottom.
2. **Given** Watch is following the running cell, **When** the agent records a new step, **Then** it appears within 3 seconds without a page reload.
3. **Given** Watch is following the running cell, **When** that cell ends and the next one starts, **Then** Watch shows the new cell.
4. **Given** a step row, **When** the user clicks it, **Then** the full arguments or content expand inline, and clicking again collapses them.

---

### User Story 2 - Compare setups on the same task (Priority: P2)

The user switches Live to Compare and sees one column per setup of the run for one task and trial. The setup currently running streams live. Setups that already ran show their recorded steps and outcome. Setups not reached yet show as queued and start streaming when their turn comes.

**Why this priority**: Comparing how harnesses and models approach the same problem is the reason to run an evaluation. It builds on the event stream from Story 1.

**Independent Test**: Run two setups on one task, wait for the first to finish, switch to Compare while the second runs, and confirm the first column shows the recorded run with its outcome while the second streams.

**Acceptance Scenarios**:

1. **Given** a run with N setups, **When** the user selects Compare, **Then** N columns appear for the task and trial of the running cell, each labelled with its setup and state (live, done, or queued).
2. **Given** Compare is open, **When** the user picks another task and trial, **Then** every column shows that task and trial.
3. **Given** a queued column, **When** its cell starts, **Then** the column turns live and starts streaming without user action.
4. **Given** a done column, **Then** it shows the outcome, agent time, step count, and cost when reported.

---

### User Story 3 - Open any cell from the results (Priority: P3)

From the Results table the user opens a specific cell, live or finished, in Watch to read what the agent did.

**Why this priority**: Useful after a run as well as during it, and needs no new data beyond Stories 1 and 2.

**Independent Test**: In a finished run, click a cell and confirm Watch shows its recorded steps and stops following live cells.

**Acceptance Scenarios**:

1. **Given** the Results table, **When** the user opens a cell, **Then** Live opens in Watch on that cell and no longer auto-follows the running cell.
2. **Given** Watch is pinned to a cell, **When** the user chooses "Follow live", **Then** Watch follows the running cell again.

---

### Edge Cases

- A recorded run left marked as running by a process that is no longer alive never shows as live.
- A run whose current cell cannot be determined (a real-task run after the app restarted) shows a clear "current cell unknown" state instead of guessing.
- A malformed or half-written step is skipped. The rest of the stream still shows.
- A cell that crashed or was unavailable shows its recorded steps and the reason it stopped.
- No run is active: Live shows the most recent run's recorded cells and says nothing is running.
- A very long tool result or argument shows truncated in the row and in full only when expanded.
- The user cancels the run: the live column ends in its final state and nothing keeps streaming.
- Several browser tabs open Live at once: each tab stays current and other tabs do not receive transcript content they did not request.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Evaluating page MUST offer a Live view beside Results, with a Watch | Compare toggle.
- **FR-002**: Live MUST show, for a cell, its steps in order: agent messages, tool calls (tool name and a short argument summary), tool results (with failure flag), and spend updates.
- **FR-003**: While a cell runs, new steps MUST appear within 3 seconds of being recorded, without a reload.
- **FR-004**: Watch MUST follow the running cell by default and switch to the next cell when it starts.
- **FR-005**: Users MUST be able to pin Watch to any cell of the run (from Results) and return to following live.
- **FR-006**: Compare MUST show one column per setup of the run for one task and trial, defaulting to the running cell's task and trial, with a picker for other tasks and trials.
- **FR-007**: Each column MUST show its state (live, done, queued, or unknown), elapsed or agent time, step count, and cost when the harness reports it. Done columns MUST show the outcome.
- **FR-008**: A cell MUST be shown as live only when its agent process is still alive.
- **FR-009**: The same view MUST work for benchmark and real-task runs and for every harness the evaluator drives.
- **FR-010**: Finished cells MUST be viewable after the run ends, from the same recorded data.
- **FR-011**: Step content MUST be sent only to the browser tab that requested that cell. Broadcast notifications MUST carry identifiers only.
- **FR-012**: Malformed recorded steps MUST be skipped without breaking the view.
- **FR-013**: Clicking a step MUST expand its full content, and clicking again MUST collapse it.

### Key Entities

- **Live step**: one recorded agent event. It has a position in the cell's stream, a time, a kind (message, tool call, tool result, spend, error), a short summary, and full content on request.
- **Cell stream**: the ordered steps of one cell plus its state (live, done, queued, unknown), its setup, task, trial, and totals.
- **Activity notice**: a lightweight signal that a cell has new steps. It carries the run, the cell, and the latest position only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a live run, 95% of new agent steps are visible in the Live view within 3 seconds of being recorded.
- **SC-002**: A user can tell which tool the running agent is using right now in under 5 seconds after opening the Evaluating page.
- **SC-003**: With up to 8 setups, Compare shows all columns for a task and trial in one screen without horizontal page scrolling at 1440 px width.
- **SC-004**: Zero cases where a dead agent's record shows as live, across cancel and resume.
- **SC-005**: A finished cell's recorded steps match the steps that were shown live for it (same count and order).

## Assumptions

- The evaluator runs one cell at a time, so at most one cell is live. Comparing several agents running at the same moment is out of scope.
- Steps arrive at the granularity the evaluator records (whole messages and tool calls), not token by token.
- The app is served on loopback to the same user who owns the transcripts, as today.
- Controlling the agent (pause, send input) is out of scope.
- All setups of a run appear in Compare. Picking a subset is out of scope while runs are capped at 8 setups.
