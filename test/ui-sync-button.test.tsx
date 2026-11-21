import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SyncButton } from "../src/ui/sync-button.tsx";
import { readUiFile } from "./ui-source.ts";

const topbar = (busy: boolean, label: "Sync" | "Update") =>
  renderToStaticMarkup(
    <SyncButton
      ariaLabel="Sync session logs"
      busy={busy}
      label={label}
      labels={["Sync", "Update"]}
      onClick={() => {}}
      update={label === "Update"}
    />,
  );

test("a busy sync button keeps its label so the button does not shrink", () => {
  const html = renderToStaticMarkup(
    <SyncButton ariaLabel="Re-sync session logs" busy label="Re-sync" onClick={() => {}} />,
  );
  expect(html).toMatch(/<span[^>]*data-active="true">Re-sync<\/span>/);
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("disabled");
  expect(html).toContain("animate-spin");
});

test("the topbar button lays out every label in each state so its width never changes", () => {
  for (const html of [topbar(false, "Sync"), topbar(true, "Sync"), topbar(false, "Update")]) {
    expect(html).toContain(">Sync</span>");
    expect(html).toContain(">Update</span>");
  }
  expect(topbar(false, "Update")).toMatch(/<span[^>]*data-active="true">Update<\/span>/);
});

test("phone widths show the topbar sync button as an icon so the topbar does not overflow", () => {
  expect(readUiFile("main.tsx")).toContain("max-md:[&_[data-sync-label]]:hidden");
});
