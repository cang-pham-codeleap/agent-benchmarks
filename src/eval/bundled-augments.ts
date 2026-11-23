import bashCap from "../../evals/augments/bash-cap.json";
import caveman from "../../evals/augments/caveman.json";
import cavemanPrompt from "../../evals/augments/caveman.md" with { type: "file" };
import codegraph from "../../evals/augments/codegraph.json";
import ponytail from "../../evals/augments/ponytail.json";
import ponytailPrompt from "../../evals/augments/ponytail.md" with { type: "file" };
import ptc from "../../evals/augments/ptc.json";
import rtk from "../../evals/augments/rtk.json";
import rtkOmpExtension from "../../evals/augments/rtk-omp-extension.txt" with { type: "file" };

/** Augment id to its raw definition; imported so the compiled binary carries them. */
export const BUNDLED_AUGMENTS: Readonly<Record<string, unknown>> = {
  "bash-cap": bashCap,
  caveman,
  codegraph,
  ponytail,
  ptc,
  rtk,
};

/** File name to readable path for a bundled `from`; a compiled binary cannot list its embedded files. */
export const BUNDLED_AUGMENT_FILES: Readonly<Record<string, string>> = {
  "caveman.md": cavemanPrompt,
  "ponytail.md": ponytailPrompt,
  "rtk-omp-extension.txt": rtkOmpExtension,
};
