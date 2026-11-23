import { afterAll, afterEach, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, type ReactElement } from "react";
import type { Root } from "react-dom/client";

const globalsCss = readFileSync(join(import.meta.dir, "..", "src", "ui", "globals.css"), "utf8");

export function applyGlobalsCss() {
  const style = document.createElement("style");
  // happy-dom does not cascade through @layer, so the base layer is applied unwrapped.
  style.textContent = globalsCss.replace(/@layer base \{([\s\S]*?)\n\}\n/, "$1");
  document.head.replaceChildren(style);
}

export type PendingRequest = {
  url: string;
  body: unknown;
  signal: AbortSignal | null | undefined;
  respond: (payload: unknown, status?: number) => void;
};

export function installDom() {
  beforeAll(() => {
    GlobalRegistrator.register({ url: "http://localhost/" });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });
}

export function setupDom() {
  const roots: Root[] = [];
  installDom();
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await act(async () => root.unmount());
    }
    document.body.innerHTML = "";
    localStorage.clear();
  });

  return {
    async render(element: ReactElement) {
      // react-dom/client probes `window` once at import, so it must load after register().
      const { createRoot } = await import("react-dom/client");
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      roots.push(root);
      await act(async () => root.render(element));
      return {
        container,
        rerender: (next: ReactElement) => act(async () => root.render(next)),
      };
    },
  };
}

export type FetchStub = { pending: PendingRequest[]; restore: () => void };

export function stubFetch(): FetchStub {
  const pending: PendingRequest[] = [];
  const original = globalThis.fetch;
  const fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const { promise, resolve, reject } = Promise.withResolvers<Response>();
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    pending.push({
      url: String(input),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      signal: init.signal,
      respond: (payload, status = 200) => resolve(Response.json(payload, { status })),
    });
    return promise;
  };
  globalThis.fetch = Object.assign(fetch, { preconnect: original.preconnect });
  return {
    pending,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export async function flush(ms = 0) {
  await act(async () => {
    await Bun.sleep(ms);
  });
}

export async function fire(target: EventTarget | null, event: Event) {
  if (target == null) throw new Error(`${event.type} target missing`);
  await act(async () => {
    target.dispatchEvent(event);
  });
}

export function click(element: Element | null) {
  return fire(element, new MouseEvent("click", { bubbles: true, cancelable: true }));
}

export function press(element: Element | null, key: string) {
  return fire(element, new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

export async function type(element: Element | null, value: string) {
  if (!(element instanceof HTMLInputElement)) throw new Error("input target missing");
  // React tracks the last value it rendered; only the prototype setter bypasses that tracker.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  await fire(element, new Event("input", { bubbles: true }));
}

export function byText(root: ParentNode, selector: string, text: string | RegExp) {
  return (
    [...root.querySelectorAll(selector)].find((node) =>
      typeof text === "string"
        ? node.textContent?.trim() === text
        : text.test(node.textContent ?? ""),
    ) ?? null
  );
}
