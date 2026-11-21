import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "./api.ts";
import { ApiFailureState } from "./api-failure.tsx";
import { EmptyState, PrivacyReviewLists } from "./common.tsx";
import { errorMessage } from "./format.ts";
import { Icon } from "./icons.tsx";
import { Link } from "./link.tsx";

export const ANALYTICS_REPORT_INCLUDES = [
  "Selected date range, local timezone, session totals, tokens, and estimated costs",
  "Model names and full project paths, activity charts, and token economics",
  "For all-time reports, up to five open insight titles, details, impact labels, and suggestions",
] as const;

export const SESSION_REPORT_INCLUDES = [
  "Session title and first user-prompt preview (up to 180 characters)",
  "Full project path, model, effort, dates, and estimated cost",
  "Context-window and token-economics summaries",
  "Tool-call aggregates and up to 25 referenced file paths",
] as const;

export const ANALYTICS_REPORT_NEVER_INCLUDES = [
  "Transcript messages, tool inputs, or tool-result bodies",
  "Credentials, source-file contents, or the session-log database",
  "Remote scripts, fonts, or tracking pixels",
] as const;

export const SESSION_REPORT_NEVER_INCLUDES = [
  "Transcript messages beyond the disclosed prompt preview, tool inputs, or tool-result bodies",
  "Credentials, source-file contents, or the session-log database",
  "Remote scripts, fonts, or tracking pixels",
] as const;

export function ExportReviewSheet({
  actions,
  excluded,
  includes,
  notice,
  onClose,
  open,
  title,
}: {
  actions: ReactNode;
  excluded: readonly string[];
  includes: readonly string[];
  notice?: ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (returnFocus.current != null) {
            event.preventDefault();
            returnFocus.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Privacy review</DialogDescription>
        </DialogHeader>
        <PrivacyReviewLists
          className="grid gap-4 sm:grid-cols-2"
          excluded={excluded}
          excludedLabel="It never includes"
          included={includes}
          includedLabel="This report includes"
        />
        {notice}
        <DialogFooter>{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReportExportButton({
  excluded,
  href,
  includes,
  previewHref,
  title,
}: {
  excluded: readonly string[];
  href: string;
  includes: readonly string[];
  previewHref: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeReview = useCallback(() => setOpen(false), []);

  const printReport = () => {
    const preview = window.open("", "_blank", "noopener=false");
    if (preview == null) {
      setError("Allow pop-ups for this local page, then try again.");
      return;
    }
    preview.document.write("<p style='font-family:system-ui;padding:2rem'>Preparing report…</p>");
    setPrinting(true);
    setError(null);
    void fetch(href)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Report request failed (${response.status})`);
        }
        const documentHtml = await response.text();
        preview.document.open();
        preview.document.write(documentHtml);
        preview.document.close();
        await waitForReportFonts(preview.document);
        preview.focus();
        preview.print();
        closeReview();
      })
      .catch((reason: unknown) => {
        preview.close();
        setError(errorMessage(reason));
      })
      .finally(() => setPrinting(false));
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button">
        <Icon name="eye" />
        View report
      </Button>
      <ExportReviewSheet
        actions={
          <>
            <Button variant="outline" disabled={printing} onClick={printReport} type="button">
              <Icon name="filePdf" />
              Save as PDF
            </Button>
            <a
              className={buttonVariants({ variant: "outline" })}
              download
              href={href}
              onClick={closeReview}
            >
              <Icon name="fileCode" />
              Download HTML
            </a>
            <Link className={buttonVariants()} href={previewHref} onClick={closeReview}>
              <Icon name="eye" />
              View report
            </Link>
          </>
        }
        excluded={excluded}
        includes={includes}
        notice={
          error != null ? (
            <div
              role="alert"
              className="rounded-md border border-destructive p-3 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null
        }
        onClose={closeReview}
        open={open}
        title={title}
      />
    </>
  );
}

export function ReportRouteExportActions({
  downloadHref,
  excluded,
  includes,
  onPrint,
  printDisabled,
  title,
}: {
  downloadHref: string;
  excluded: readonly string[];
  includes: readonly string[];
  onPrint: () => void;
  printDisabled: boolean;
  title: string;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const closeReview = useCallback(() => setReviewOpen(false), []);
  return (
    <>
      <Button variant="outline" onClick={() => setReviewOpen(true)} type="button">
        <Icon name="fileCode" />
        Download HTML
      </Button>
      <Button disabled={printDisabled} onClick={() => setReviewOpen(true)} type="button">
        <Icon name="filePdf" />
        Save as PDF
      </Button>
      <ExportReviewSheet
        actions={
          <>
            <Button
              variant="outline"
              disabled={printDisabled}
              onClick={() => {
                closeReview();
                onPrint();
              }}
              type="button"
            >
              <Icon name="filePdf" />
              Save as PDF
            </Button>
            <a
              className={buttonVariants({ variant: "outline" })}
              download
              href={downloadHref}
              onClick={closeReview}
            >
              <Icon name="fileCode" />
              Download HTML
            </a>
          </>
        }
        excluded={excluded}
        includes={includes}
        onClose={closeReview}
        open={reviewOpen}
        title={`Review ${title.toLowerCase()}`}
      />
    </>
  );
}

export function ReportRouteView({
  backHref,
  downloadHref,
  excluded,
  includes,
  onSync,
  sourceHref,
  title,
}: {
  backHref: string;
  downloadHref: string;
  excluded: readonly string[];
  includes: readonly string[];
  onSync: () => void;
  sourceHref: string;
  title: string;
}) {
  const [documentHtml, setDocumentHtml] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [retryKey, setRetryKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    void retryKey;
    const controller = new AbortController();
    setDocumentHtml(null);
    setError(null);
    void fetchReportHtml(sourceHref, controller.signal)
      .then(setDocumentHtml)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason);
        }
      });
    return () => controller.abort();
  }, [retryKey, sourceHref]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex min-h-14 flex-wrap items-center gap-2 border-b bg-background px-6 py-2 print:hidden">
        <Link className={buttonVariants({ variant: "outline" })} href={backHref}>
          <Icon name="arrowLeft" />
          Back
        </Link>
        <strong className="mr-auto">{title}</strong>
        <ReportRouteExportActions
          downloadHref={downloadHref}
          excluded={excluded}
          includes={includes}
          onPrint={() => {
            const frameWindow = frameRef.current?.contentWindow;
            if (frameWindow != null) {
              void waitForReportFonts(frameWindow.document).then(() => frameWindow.print());
            }
          }}
          printDisabled={documentHtml == null}
          title={title}
        />
      </header>
      {error != null ? (
        <div className="mx-auto my-8 max-w-3xl px-5">
          <ApiFailureState
            error={error}
            onRetry={() => setRetryKey((key) => key + 1)}
            onSync={onSync}
          />
        </div>
      ) : documentHtml == null ? (
        <div className="mx-auto my-8 max-w-3xl px-5">
          <EmptyState
            icon="file"
            message="Preparing the local report preview."
            title="Loading report"
          />
        </div>
      ) : (
        <iframe
          className="block h-[calc(100vh-3.5rem)] w-full border-0 bg-white print:h-screen"
          ref={frameRef}
          sandbox="allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox"
          srcDoc={documentHtml}
          title={`${title} preview`}
        />
      )}
    </div>
  );
}

export async function waitForReportFonts(document: Document): Promise<void> {
  if (document.fonts == null) {
    return;
  }
  await document.fonts.ready;
}

export async function fetchReportHtml(path: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(path, {
    headers: { accept: "text/html, application/json" },
    signal,
  });
  if (response.ok) {
    return response.text();
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {}
  const code =
    typeof payload.code === "string" && payload.code !== "" ? payload.code : "request_failed";
  const message =
    typeof payload.error === "string" && payload.error !== ""
      ? payload.error
      : `Report request failed (${response.status})`;
  const { code: _code, error: _error, ...extras } = payload;
  throw new ApiError(response.status, code, message, extras);
}
