import { HelpLabel } from "../../help-label.tsx";

const GLOSSARY = {
  "Pass rate": "Share of graded trials that passed.",
  Spend:
    "Total model cost across all trials at current pricing. Shown only when every trial is priced.",
  "Agent p50":
    "Median time the agent spent on one trial: half of the trials finished faster. Lower is better.",
  "Agent p50 / p95":
    "Median and 95th-percentile agent time per trial. p95 exposes slow outliers: 95% of trials finished within it.",
  "pass@k":
    "Chance that at least one of k trials on a task passes, averaged over tasks graded for every setup.",
  "pass^k":
    "Chance that all k trials on a task pass, averaged over tasks graded for every setup. Measures consistency.",
  "Cost / solved": "Total spend divided by the number of passed trials.",
  "Time / solved": "Total agent time divided by the number of passed trials.",
  Hidden: "Hidden tests from the reference commit, run against the agent's change. Passed / total.",
  Checks: "Project check commands (such as bun test) run after the agent finished. Passed / total.",
  Overlap: "Share of the files changed by the reference commit that the agent also changed.",
  "Size ratio":
    "Lines the agent changed divided by lines the reference commit changed. 1.00x matches the human change.",
} as const satisfies Record<string, string>;

export type GlossaryTerm = keyof typeof GLOSSARY;

export function Term({ name }: { name: GlossaryTerm }) {
  return <HelpLabel label={name} help={GLOSSARY[name]} />;
}
