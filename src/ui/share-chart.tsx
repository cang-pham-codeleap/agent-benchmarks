import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  type AnalyticsChartMetric,
  type AnalyticsChartVariant,
  prepareAnalyticsChartState,
} from "./chart-state.ts";
import { buildChartOption, type ChartColors } from "./charts.tsx";
import { PrivacyReviewLists } from "./common.tsx";
import { errorMessage } from "./format.ts";
import { Icon } from "./icons.tsx";
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_SCALE,
  SHARE_CARD_WIDTH,
  SHARE_EXCLUDED_FIELDS,
  SHARE_INCLUDED_FIELDS,
  type ShareCardCopyInput,
  type ShareCardKind,
  shareCardAltText,
  shareCardButtonLabel,
  shareCardCaption,
  shareCardFilename,
  shareCardQualifier,
  shareCardTakeaway,
  shareCardTitle,
} from "./share-card.ts";

export function ShareChartButton({
  disabled = false,
  input,
  metric,
  variant,
}: {
  disabled?: boolean;
  input: ShareCardCopyInput;
  metric: AnalyticsChartMetric;
  variant: AnalyticsChartVariant;
}) {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [png, setPng] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const renderVersionRef = useRef(0);
  const title = shareCardTitle(input.kind);
  const caption = shareCardCaption(input);
  const altText = shareCardAltText(input);
  const filename = shareCardFilename(input.kind, input.start, input.end);

  const setPreview = useCallback((blob: Blob | null) => {
    if (previewUrlRef.current != null) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    const nextUrl = blob == null ? null : URL.createObjectURL(blob);
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
    setPng(blob);
  }, []);

  const renderPreview = useCallback(async () => {
    const version = renderVersionRef.current + 1;
    renderVersionRef.current = version;
    setBusy(true);
    setStatus(null);
    try {
      const blob = await renderShareCardPng(input, metric, variant);
      if (renderVersionRef.current === version) {
        setPreview(blob);
      }
    } catch (error) {
      if (renderVersionRef.current === version) {
        setStatus(`Unable to render image: ${errorMessage(error)}`);
        setPreview(null);
      }
    } finally {
      if (renderVersionRef.current === version) {
        setBusy(false);
      }
    }
  }, [input, metric, setPreview, variant]);

  useEffect(
    () => () => {
      renderVersionRef.current += 1;
      if (previewUrlRef.current != null) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    },
    [],
  );


  const copyText = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(success);
    } catch (error) {
      setStatus(`Clipboard unavailable: ${errorMessage(error)}`);
    }
  };

  const copyImage = async () => {
    if (png == null || typeof ClipboardItem === "undefined" || navigator.clipboard?.write == null) {
      setStatus("Image copying is unavailable in this browser. Download the PNG instead.");
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setStatus("Image copied.");
    } catch (error) {
      setStatus(`Image copy failed: ${errorMessage(error)}`);
    }
  };

  const download = () => {
    if (previewUrl == null) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.download = filename;
    anchor.href = previewUrl;
    anchor.click();
    setStatus(`Downloaded ${filename}.`);
  };

  const nativeShare = async () => {
    if (png == null || navigator.share == null) {
      setStatus("The native share sheet is unavailable in this browser.");
      return;
    }
    const file = new File([png], filename, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] }) === false) {
      setStatus("This browser cannot share PNG files. Download the image instead.");
      return;
    }
    try {
      await navigator.share({ files: [file], title, text: caption });
      setStatus("Shared from your device.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus("Share canceled.");
      } else {
        setStatus(`Share failed: ${errorMessage(error)}`);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
      <Button variant="outline" size="sm" aria-label={shareCardButtonLabel(input.kind)} disabled={disabled} onClick={() => { setOpen(true); void renderPreview(); }} type="button">
        <Icon name="share" /> Share
      </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review {title}</DialogTitle>
          <DialogDescription>Local, aggregate-only export</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            {busy ? <div className="rounded-md bg-muted p-8 text-center text-sm">Rendering locally…</div> : previewUrl == null ? <div className="rounded-md bg-muted p-8 text-center text-sm">Preview unavailable</div> : <img alt={altText} src={previewUrl} className="w-full rounded-md" />}
            <p className="mt-2 text-sm text-muted-foreground">2× high-density PNG · 2400 × 1260</p>
          </div>
          <PrivacyReviewLists className="grid gap-4 sm:grid-cols-2" excluded={SHARE_EXCLUDED_FIELDS} excludedLabel="Always excluded" included={SHARE_INCLUDED_FIELDS} includedLabel="Included" />
          <div className="grid gap-4 text-sm sm:grid-cols-2"><div><strong>Caption</strong><p>{caption}</p></div><div><strong>Alt text</strong><p>{altText}</p></div></div>
        </div>
        <DialogFooter className="flex-wrap">
          <Button variant="outline" disabled={png == null || busy} onClick={() => void copyImage()} type="button"><Icon name="copy" /> Copy image</Button>
          <Button variant="outline" disabled={png == null || busy} onClick={download} type="button"><Icon name="download" /> Download PNG</Button>
          <Button variant="outline" disabled={png == null || busy} onClick={() => void nativeShare()} type="button"><Icon name="share" /> Share…</Button>
          <Button variant="outline" onClick={() => void copyText(caption, "Caption copied.")} type="button">Copy caption</Button>
          <Button variant="outline" onClick={() => void copyText(altText, "Alt text copied.")} type="button">Copy alt text</Button>
        </DialogFooter>
        <p aria-live="polite" className="text-sm text-muted-foreground">{status ?? "Nothing leaves this machine until you act."}</p>
      </DialogContent>
    </Dialog>
  );
}

const SHARE_CARD_PANEL = "#11151f";

export const SHARE_CHART_COLORS: ChartColors = {
  fg: "#e7eaf0",
  hover: "rgba(255, 255, 255, 0.05)",
  muted: "#9aa6b8",
  faint: "#6b7689",
  line: "rgba(255, 255, 255, 0.08)",
  surface: "#1a1f2b",
  accent: "#ee67d1",
  info: "#38bdf8",
  success: "#bef264",
  warning: "#fcd34d",
};

function shareCardPeriod(kind: ShareCardKind): "category" | "day" | "week" {
  switch (kind) {
    case "sessions_per_day":
    case "estimated_cost_per_day":
      return "day";
    case "sessions_per_week":
    case "estimated_cost_per_week":
      return "week";
    default:
      return "category";
  }
}

export async function renderShareCardPng(
  input: ShareCardCopyInput,
  metric: AnalyticsChartMetric,
  variant: AnalyticsChartVariant,
): Promise<Blob> {
  const scale = SHARE_CARD_SCALE;
  const chartNode = document.createElement("div");
  chartNode.style.cssText =
    "position:fixed;left:-10000px;top:-10000px;width:1080px;height:310px;pointer-events:none";
  document.body.append(chartNode);
  const echarts = await import("./chart-runtime.ts");
  const chart = echarts.init(chartNode, null, {
    renderer: "canvas",
    width: 1080,
    height: 310,
  });
  let chartUrl: string;
  try {
    const state = prepareAnalyticsChartState({
      labels: input.labels,
      metric,
      period: shareCardPeriod(input.kind),
      values: input.values,
      variant,
    });
    chart.setOption(
      {
        ...buildChartOption(state, SHARE_CHART_COLORS),
        animation: false,
        backgroundColor: SHARE_CARD_PANEL,
      },
      true,
    );
    chartUrl = chart.getDataURL({
      backgroundColor: SHARE_CARD_PANEL,
      pixelRatio: Math.max(1, scale),
      type: "png",
    });
  } finally {
    chart.dispose();
    chartNode.remove();
  }

  const chartImage = await loadCanvasImage(chartUrl);
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_CARD_WIDTH * scale;
  canvas.height = SHARE_CARD_HEIGHT * scale;
  const context = canvas.getContext("2d");
  if (context == null) {
    throw new Error("2D canvas is unavailable");
  }
  context.scale(scale, scale);
  context.fillStyle = "#0b0e14";
  context.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
  context.fillStyle = SHARE_CARD_PANEL;
  context.fillRect(42, 34, SHARE_CARD_WIDTH - 84, SHARE_CARD_HEIGHT - 68);

  context.fillStyle = "#e7eaf0";
  context.font = "650 22px Inter, ui-sans-serif, system-ui, sans-serif";
  context.fillText("Agent Benchmarks", 68, 83);
  context.fillStyle = "#9aa6b8";
  context.font = "500 17px Inter, ui-sans-serif, system-ui, sans-serif";
  context.textAlign = "right";
  context.fillText(shareCardRange(input), SHARE_CARD_WIDTH - 68, 81);
  context.textAlign = "left";

  context.fillStyle = "#e7eaf0";
  context.font = "650 36px Inter, ui-sans-serif, system-ui, sans-serif";
  context.fillText(shareCardTitle(input.kind), 68, 142);
  context.fillStyle = "#9aa6b8";
  context.font = "500 22px Inter, ui-sans-serif, system-ui, sans-serif";
  context.fillText(shareCardTakeaway(input), 68, 178);
  context.drawImage(chartImage, 68, 204, SHARE_CARD_WIDTH - 136, 304);

  context.fillStyle = "#6b7689";
  context.font = "500 16px Inter, ui-sans-serif, system-ui, sans-serif";
  context.fillText(shareCardQualifier(input), 68, 557);

  return await canvasPngBlob(canvas);
}

export function loadCanvasImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load local image asset: ${src}`));
    image.src = src;
  });
}

export function canvasPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob == null) {
        reject(new Error("PNG encoding failed"));
      } else {
        resolve(blob);
      }
    }, "image/png");
  });
}

export function shareRange(labels: string[]): { start: string; end: string } {
  return {
    start: labels[0] ?? "All time",
    end: labels.at(-1) ?? "All time",
  };
}

export function shareCardRange(input: ShareCardCopyInput): string {
  const range = input.start === input.end ? input.start : `${input.start}–${input.end}`;
  return `${range} · ${input.timezone}`;
}

export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
}
