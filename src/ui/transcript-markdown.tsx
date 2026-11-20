import { Fragment, memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TranscriptHighlight } from "./shiki-highlighter.ts";
import {
  markdownLinkBehavior,
  measureTranscriptContent,
  normalizeTranscriptLanguage,
  safeMarkdownUrl,
  type TranscriptLanguage,
  type TranscriptTheme,
} from "./transcript-rendering.ts";

export interface TranscriptMarkdownProps {
  children: string;
  className?: string;
  defaultLanguage?: TranscriptLanguage | null;
}

export interface TranscriptCodeBlockProps {
  code: string;
  deferUntilVisible?: boolean;
  language?: string | null;
}

const REMARK_PLUGINS = [remarkGfm];

function transformMarkdownUrl(url: string, key: string): string | null {
  return key === "src" ? null : (safeMarkdownUrl(url) ?? null);
}

export const TranscriptMarkdown = memo(function TranscriptMarkdown({
  children,
  className,
  defaultLanguage = null,
}: TranscriptMarkdownProps) {
  const components = useMemo<Components>(
    () => ({
      a({ children: linkChildren, href }) {
        const behavior = markdownLinkBehavior(href);
        if (behavior.href == null) {
          return <span>{linkChildren}</span>;
        }
        return (
          <a className="text-primary underline underline-offset-4" href={behavior.href} rel={behavior.rel} target={behavior.target}>
            {linkChildren}
          </a>
        );
      },
      code({ children: codeChildren, className: codeClassName, ...props }) {
        const value = String(codeChildren);
        const fenceLanguage = codeClassName?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? null;
        const language = normalizeTranscriptLanguage(fenceLanguage) ?? defaultLanguage;
        const block = fenceLanguage != null || value.endsWith("\n");
        if (!block) {
          return (
            <code className={`rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] ${codeClassName ?? ""}`} {...props}>
              {codeChildren}
            </code>
          );
        }
        return <TranscriptCodeBlock code={value.replace(/\n$/, "")} language={language} />;
      },
      img() {
        return null;
      },
      pre({ children: preChildren }) {
        return <Fragment>{preChildren}</Fragment>;
      },
    }),
    [defaultLanguage],
  );

  return (
    <div className={`min-w-0 space-y-3 break-words text-sm leading-relaxed [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_h1]:text-xl [&_h2]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc ${className ?? ""}`}>
      <Markdown
        components={components}
        remarkPlugins={REMARK_PLUGINS}
        skipHtml
        urlTransform={transformMarkdownUrl}
      >
        {children}
      </Markdown>
    </div>
  );
});

export function TranscriptCodeBlock({
  code,
  deferUntilVisible = true,
  language,
}: TranscriptCodeBlockProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const visible = useVisible(containerRef, deferUntilVisible);
  const theme = useTranscriptTheme();
  const measure = measureTranscriptContent(code);
  const normalizedLanguage = normalizeTranscriptLanguage(language);
  const [highlight, setHighlight] = useState<TranscriptHighlight | null>(null);

  useEffect(() => {
    let active = true;
    setHighlight(null);
    if (!visible || normalizedLanguage == null || !measure.shouldHighlight) {
      return () => {
        active = false;
      };
    }
    void import("./shiki-highlighter.ts")
      .then(({ highlightTranscriptCode }) =>
        highlightTranscriptCode(code, normalizedLanguage, theme),
      )
      .then((next) => {
        if (active) {
          setHighlight(next);
        }
      })
      .catch(() => {
        if (active) {
          setHighlight(null);
        }
      });
    return () => {
      active = false;
    };
  }, [code, measure.shouldHighlight, normalizedLanguage, theme, visible]);

  return (
    <section
      aria-label={normalizedLanguage == null ? "Code" : `${normalizedLanguage} code`}
      className="min-w-0 overflow-x-auto rounded-md border bg-muted/40"
      data-language={normalizedLanguage ?? undefined}
      data-theme={theme}
      ref={containerRef}
    >
      <pre className="overflow-x-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed" style={{ color: highlight?.foreground }}>
        <code>
          {highlight == null
            ? code
            : highlight.tokens.flatMap((line, lineIndex) => [
                ...line.map((token) => (
                  <span key={token.offset} style={tokenStyle(token)}>
                    {token.content}
                  </span>
                )),
                lineIndex < highlight.tokens.length - 1 ? "\n" : null,
              ])}
        </code>
      </pre>
    </section>
  );
}

function currentTranscriptTheme(): TranscriptTheme {
  if (typeof document === "undefined") {
    return "light";
  }
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "dark" || explicit === "light") {
    return explicit;
  }
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

const themeListeners = new Set<() => void>();
let detachThemeListeners: (() => void) | null = null;

function notifyThemeListeners() {
  for (const listener of themeListeners) {
    listener();
  }
}

function subscribeToTranscriptTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  if (detachThemeListeners == null) {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    window.addEventListener("decant:set-theme", notifyThemeListeners);
    media?.addEventListener("change", notifyThemeListeners);
    detachThemeListeners = () => {
      window.removeEventListener("decant:set-theme", notifyThemeListeners);
      media?.removeEventListener("change", notifyThemeListeners);
    };
  }
  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0) {
      detachThemeListeners?.();
      detachThemeListeners = null;
    }
  };
}

function useTranscriptTheme(): TranscriptTheme {
  return useSyncExternalStore(subscribeToTranscriptTheme, currentTranscriptTheme, () => "light");
}

function useVisible(ref: { current: HTMLElement | null }, defer: boolean): boolean {
  const [visible, setVisible] = useState(
    () => !defer || typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (!defer) {
      setVisible(true);
      return;
    }
    if (visible) {
      return;
    }
    const element = ref.current;
    if (element == null || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [defer, ref, visible]);

  return visible;
}

function tokenStyle(token: { bgColor?: string; color?: string; fontStyle?: number }): {
  backgroundColor?: string;
  color?: string;
  fontStyle?: "italic";
  fontWeight?: number;
  textDecoration?: "underline";
} {
  const style: {
    backgroundColor?: string;
    color?: string;
    fontStyle?: "italic";
    fontWeight?: number;
    textDecoration?: "underline";
  } = {
    backgroundColor: token.bgColor,
    color: token.color,
  };
  if (((token.fontStyle ?? 0) & 1) !== 0) {
    style.fontStyle = "italic";
  }
  if (((token.fontStyle ?? 0) & 2) !== 0) {
    style.fontWeight = 700;
  }
  if (((token.fontStyle ?? 0) & 4) !== 0) {
    style.textDecoration = "underline";
  }
  return style;
}
