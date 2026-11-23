import { describe, expect, test } from "bun:test";
import { ReportExportButton, ReportRouteExportActions } from "../src/ui/report-export.tsx";
import { SHARE_EXCLUDED_FIELDS } from "../src/ui/share-card.ts";
import { ShareChartButton } from "../src/ui/share-chart.tsx";
import { byText, click, flush, setupDom } from "./ui-dom.ts";

const dom = setupDom();

function reviewDialog() {
  const dialog = document.querySelector('[role="dialog"]');
  const title = document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "");
  const items = [...(dialog?.querySelectorAll("li") ?? [])].map((item) => item.textContent);
  return { dialog, items, title: title?.textContent };
}

describe("privacy reviews", () => {
  test("a report export opens a titled review listing what it includes and excludes", async () => {
    const { container } = await dom.render(
      <ReportExportButton
        excluded={["Prompt text"]}
        href="/api/reports/analytics.html"
        includes={["Full project paths"]}
        previewHref="/reports/analytics"
        title="Analytics report"
      />,
    );
    expect(reviewDialog().dialog).toBeNull();
    const opener = byText(container, "button", "View report");
    if (opener instanceof HTMLElement) opener.focus();
    await click(opener);

    const review = reviewDialog();
    expect(review.title).toBe("Analytics report");
    expect(review.items).toEqual(["Full project paths", "Prompt text"]);
    expect(byText(review.dialog ?? document, "a", "Download HTML")?.getAttribute("href")).toBe(
      "/api/reports/analytics.html",
    );

    await click(byText(review.dialog ?? document, "button", "Close"));
    await flush(20);
    expect(reviewDialog().dialog).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test("both report toolbar actions review before they act", async () => {
    let printed = 0;
    const { container } = await dom.render(
      <ReportRouteExportActions
        downloadHref="/report.html"
        excluded={["Prompt text"]}
        includes={["Session title"]}
        onPrint={() => {
          printed += 1;
        }}
        printDisabled={false}
        title="Session report"
      />,
    );
    for (const action of ["Download HTML", "Save as PDF"]) {
      await click(byText(container, "button", action));
      expect(reviewDialog().title).toBe("Review session report");
      expect(printed).toBe(0);
      await click(byText(reviewDialog().dialog ?? document, "button", "Close"));
      await flush();
    }
    await click(byText(container, "button", "Save as PDF"));
    await click(byText(reviewDialog().dialog ?? document, "button", "Save as PDF"));
    expect(printed).toBe(1);
  });

  test("a chart share opens a review that lists the fields it always leaves out", async () => {
    const { container } = await dom.render(
      <ShareChartButton
        input={{
          end: "2026-11-07",
          kind: "sessions_per_day",
          labels: ["2026-11-06", "2026-11-07"],
          start: "2026-11-06",
          timezone: "UTC",
          values: [2, 3],
        }}
        metric="int"
        variant="bar"
      />,
    );
    await click(container.querySelector("button"));
    await flush();

    const review = reviewDialog();
    expect(review.title).toStartWith("Review ");
    expect(review.items).toEqual(expect.arrayContaining([...SHARE_EXCLUDED_FIELDS]));
  });
});
