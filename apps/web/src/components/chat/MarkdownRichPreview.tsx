import { CodeIcon, EyeIcon } from "lucide-react";
import { use, useEffect, useRef, useState, type ReactNode } from "react";

import { richPreviewDocument, type RichPreviewKind } from "@t3tools/shared/markdownPreview";

import { serializeCodeBlockToMarkdown } from "../../markdown-clipboard";
import { observeResize } from "../../lib/observeResize";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { findRevealRef, MarkdownFindContext } from "./markdownFindContext";

const MAX_PREVIEW_HEIGHT = 480;

export function MarkdownRichPreview({
  code,
  kind,
  language,
  fenceTitle,
  theme,
  isStreaming,
  children,
}: {
  code: string;
  kind: RichPreviewKind;
  language: string;
  fenceTitle: string | null;
  theme: "light" | "dark";
  isStreaming: boolean;
  children: ReactNode;
}) {
  const srcDoc = richPreviewDocument(kind, code, theme);
  const [showCode, setShowCode] = useState(false);
  const searching = use(MarkdownFindContext);
  const revealSource = () => setShowCode(true);
  const sourceRevealRef = findRevealRef(revealSource);
  const [height, setHeight] = useState(48);
  const stopObserving = useRef<(() => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drop the frame's resize observer when the preview unmounts
  useEffect(() => () => stopObserving.current?.(), []);
  if (!srcDoc) {
    return (
      <MarkdownCodeBlock
        code={code}
        language={language}
        fenceTitle={fenceTitle}
        theme={theme}
        isStreaming={isStreaming}
      >
        {children}
      </MarkdownCodeBlock>
    );
  }
  const showPreview = !showCode;
  const toggleLabel = showPreview ? "Show code" : "Show preview";
  const noun = kind === "svg" ? "SVG" : "HTML";
  return (
    <MarkdownCodeBlock
      code={code}
      language={language}
      fenceTitle={fenceTitle}
      theme={theme}
      isStreaming={isStreaming}
      canWrap={!showPreview}
      diagram={showPreview}
      viewToggle={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost-muted"
                size="icon-xs"
                onClick={() => setShowCode((value) => !value)}
                aria-label={toggleLabel}
              />
            }
          >
            {showPreview ? <CodeIcon className="size-3" /> : <EyeIcon className="size-3" />}
          </TooltipTrigger>
          <TooltipPopup side="top">{toggleLabel}</TooltipPopup>
        </Tooltip>
      }
    >
      {showPreview ? (
        <div
          className="chat-markdown-rich-preview"
          data-markdown-rendered-block=""
          data-markdown-copy={serializeCodeBlockToMarkdown(code, language)}
        >
          <iframe
            title={`${noun} preview`}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
            tabIndex={height >= MAX_PREVIEW_HEIGHT ? 0 : undefined}
            style={{ height }}
            className="chat-markdown-rich-frame"
            onLoad={(event) => {
              const frame = event.currentTarget;
              let href = "";
              try {
                href = frame.contentWindow?.location.href ?? "";
              } catch {
                href = "";
              }
              // A click can navigate the frame. Put the sanitized document back.
              if (href && !href.startsWith("about:")) {
                frame.srcdoc = srcDoc;
                return;
              }
              stopObserving.current?.();
              const body = frame.contentDocument?.body;
              if (!body) return;
              const measure = () =>
                setHeight(
                  Math.min(
                    MAX_PREVIEW_HEIGHT,
                    Math.max(48, Math.ceil(body.getBoundingClientRect().height)),
                  ),
                );
              stopObserving.current = observeResize(body, measure);
              measure();
            }}
          />
          {searching ? (
            <pre ref={sourceRevealRef} hidden aria-hidden>
              {code}
            </pre>
          ) : null}
        </div>
      ) : (
        children
      )}
    </MarkdownCodeBlock>
  );
}
