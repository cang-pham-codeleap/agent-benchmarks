import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readUiSource } from "./ui-source.ts";

const root = join(import.meta.dir, "..");
const main = readUiSource();
const badge = readFileSync(join(root, "src", "ui", "dosu-badge.ts"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
const npmReadme = readFileSync(join(root, "npm", "decant", "README.md"), "utf8");

describe("Dosu product copy", () => {
  test("keeps attribution, contextual conversion, privacy, and provenance distinct", () => {
    expect(main).toContain("Based on Decant by Dosu (Apache-2.0)");
    expect(main).not.toContain("Built by Dosu ↗");
    expect(main).toContain("Make these patterns available to every coding agent");
    expect(main).toContain("Version {versionLabel(config?.version)}");
    expect(main).not.toContain('label="Dosu suggestions"');
    expect(badge).toContain("Optimized with Dosu;");
    expect(main).toContain('["summary", "dateBounds", "config", "update"]');
    expect(main).toContain("Agent Benchmarks {versionLabel(data.config?.version)}");
    expect(main).not.toContain("Decant {versionLabel(data.config?.version)} ↗");
    expect(main).not.toContain("saved you $");
  });

  test("uses current Dosu positioning and tracked links in public documentation", () => {
    expect(readme).toContain(
      "https://dosu.dev?utm_source=decant&utm_medium=github&utm_campaign=attribution&utm_content=readme",
    );
    expect(npmReadme).toContain(
      "https://dosu.dev?utm_source=decant&utm_medium=npm&utm_campaign=attribution&utm_content=package_readme",
    );
    for (const document of [readme, npmReadme]) {
      const normalized = document.replaceAll("\n", " ");
      expect(normalized).toContain("Knowledge Infrastructure for Agents");
      expect(normalized).toContain("Dosu helps make agents faster, cheaper, and more effective.");
      expect(normalized).not.toContain(
        "Dosu makes agents faster, cheaper, and more effective across every run.",
      );
      expect(normalized).toContain(
        "Decant is local-first. It makes no outbound network calls at runtime,",
      );
    }
  });
});
