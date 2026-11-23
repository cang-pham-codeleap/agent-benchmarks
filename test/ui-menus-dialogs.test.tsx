import { describe, expect, test } from "bun:test";
import { useState } from "react";
import { OverflowMenu } from "../src/ui/common.tsx";
import { DeleteSessionDialog } from "../src/ui/views/session-detail.tsx";
import { byText, click, fire, flush, press, setupDom } from "./ui-dom.ts";

const dom = setupDom();

describe("OverflowMenu", () => {
  async function openMenu() {
    const picked: string[] = [];
    const { container } = await dom.render(
      <OverflowMenu label="More actions for Lint rule">
        <button onClick={() => picked.push("copy")} type="button">
          Copy prompt
        </button>
      </OverflowMenu>,
    );
    const menu = container.querySelector("details");
    const summary = container.querySelector('summary[aria-label="More actions for Lint rule"]');
    if (menu == null) throw new Error("menu missing");
    menu.open = true;
    return { menu, picked, summary };
  }

  test("Escape closes the menu and returns focus to its button", async () => {
    const { menu, summary } = await openMenu();
    const item = byText(menu, "button", "Copy prompt");
    if (item instanceof HTMLElement) item.focus();
    await press(item, "Escape");
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  test("choosing an item runs it, closes the menu, and returns focus", async () => {
    const { menu, picked, summary } = await openMenu();
    await click(byText(menu, "button", "Copy prompt"));
    expect(picked).toEqual(["copy"]);
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });
});

function DialogOwner({ events, pending }: { events: string[]; pending: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Delete session
      </button>
      <DeleteSessionDialog
        error={null}
        onClose={() => {
          events.push("close");
          setOpen(false);
        }}
        onConfirm={() => events.push("confirm")}
        open={open}
        pending={pending}
        title="Refactor the parser"
      />
    </>
  );
}

describe("DeleteSessionDialog", () => {
  async function openDialog(pending = false) {
    const events: string[] = [];
    const { container } = await dom.render(<DialogOwner events={events} pending={pending} />);
    const opener = byText(container, "button", "Delete session");
    if (opener instanceof HTMLElement) opener.focus();
    await click(opener);
    await flush(20);
    const dialog = document.querySelector('[role="alertdialog"]');
    return { dialog, events, opener };
  }

  test("is a labelled modal alert that takes focus and explains what deletion does", async () => {
    const { dialog } = await openDialog();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "");
    const description = document.getElementById(dialog?.getAttribute("aria-describedby") ?? "");
    expect(title?.textContent).toBe("Delete session?");
    expect(description?.textContent?.length).toBeGreaterThan(20);
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  test("deletes only on the explicit confirm button", async () => {
    const { dialog, events } = await openDialog();
    await click(byText(dialog ?? document, "button", "Delete from Agent Benchmarks"));
    expect(events).toEqual(["confirm"]);
  });

  test("Escape, Cancel, and a backdrop press close it without deleting", async () => {
    const { dialog, events } = await openDialog();
    await press(dialog, "Escape");
    expect(events).toEqual(["close"]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    const cancelled = await openDialog();
    await click(byText(cancelled.dialog ?? document, "button", "Cancel"));
    expect(cancelled.events).toEqual(["close"]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    const backdropped = await openDialog();
    await fire(
      backdropped.dialog?.parentElement ?? null,
      new MouseEvent("mousedown", { bubbles: true }),
    );
    expect(backdropped.events).toEqual(["close"]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  test("a pending delete cannot be dismissed from the backdrop", async () => {
    const { dialog, events } = await openDialog(true);
    await fire(dialog?.parentElement ?? null, new MouseEvent("mousedown", { bubbles: true }));
    expect(events).toEqual([]);
    expect(byText(dialog ?? document, "button", "Deleting…")?.hasAttribute("disabled")).toBe(true);
  });
});
