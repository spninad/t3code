import {
  richPreviewDocument,
  sanitizedSvgMarkup,
  splitMarkdownRichFences,
  type RichPreviewKind,
} from "@t3tools/shared/markdownPreview";
import { useContext, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { parse, SvgAst, type JsxAST } from "react-native-svg";
import { WebView } from "react-native-webview";

import { AppText as Text } from "../../components/ui/AppText";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { MarkdownImageAvailableWidthContext } from "./ThreadMarkdownImage";
import { resolveMarkdownImageDisplaySize, resolveSvgImageSize } from "./markdownImageSize";

function FenceToggle(props: { readonly showCode: boolean; readonly onPress: () => void }) {
  const label = props.showCode ? "Show preview" : "Show code";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      className="self-end px-1 py-1"
      onPress={props.onPress}
    >
      <Text className="text-xs text-foreground-muted">{label}</Text>
    </Pressable>
  );
}

function SvgPreview(props: { readonly markup: string }) {
  const availableWidth = useContext(MarkdownImageAvailableWidthContext);
  const ast = useMemo(() => {
    try {
      return parse(props.markup);
    } catch {
      return null;
    }
  }, [props.markup]);
  if (!ast) return null;
  const intrinsic = resolveSvgImageSize(ast.props);
  const width = availableWidth > 0 ? availableWidth : 280;
  const display = intrinsic
    ? resolveMarkdownImageDisplaySize({
        sourceWidth: intrinsic.width,
        sourceHeight: intrinsic.height,
        availableWidth: width,
      })
    : null;
  return (
    <View
      accessibilityLabel="SVG preview"
      style={{ width: display?.width ?? width, height: display?.height ?? 160 }}
    >
      <SvgAst ast={ast as JsxAST} override={{ width: "100%", height: "100%", accessible: false }} />
    </View>
  );
}

function HtmlPreview(props: { readonly document: string; readonly source: string }) {
  const height = Math.min(360, Math.max(96, props.source.split("\n").length * 22));
  return (
    <View style={{ height }} accessibilityLabel="HTML preview">
      <WebView
        source={{ html: props.document }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        originWhitelist={["*"]}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        cacheEnabled={false}
        setSupportMultipleWindows={false}
        scrollEnabled
        nestedScrollEnabled
        onShouldStartLoadWithRequest={(request) => request.url.startsWith("about:")}
      />
    </View>
  );
}

function MarkdownRichFence(props: {
  readonly kind: RichPreviewKind;
  readonly source: string;
  readonly renderSource: () => ReactNode;
}) {
  const { themeAppearance } = useAppearancePreferences();
  const [showCode, setShowCode] = useState(false);
  const svg = useMemo(
    () => (props.kind === "svg" ? sanitizedSvgMarkup(props.source) : null),
    [props.kind, props.source],
  );
  const html = useMemo(
    () =>
      props.kind === "html" ? richPreviewDocument("html", props.source, themeAppearance) : null,
    [props.kind, props.source, themeAppearance],
  );
  const preview =
    props.kind === "svg" && svg ? (
      <SvgPreview markup={svg} />
    ) : props.kind === "html" && html ? (
      <HtmlPreview document={html} source={props.source} />
    ) : null;
  if (!preview || showCode) {
    return (
      <View>
        {preview ? <FenceToggle showCode={showCode} onPress={() => setShowCode(false)} /> : null}
        {props.renderSource()}
      </View>
    );
  }
  return (
    <View className="my-2 overflow-hidden rounded-lg border border-border bg-md-code-bg">
      <FenceToggle showCode={false} onPress={() => setShowCode(true)} />
      {preview}
    </View>
  );
}

export function ChatRichMarkdown(props: {
  readonly markdown: string;
  readonly renderMarkdown: (markdown: string) => ReactNode;
}) {
  const segments = useMemo(() => splitMarkdownRichFences(props.markdown), [props.markdown]);
  if (segments.length === 1 && segments[0]?.kind === "markdown") {
    return props.renderMarkdown(props.markdown);
  }
  return segments.map((segment) => {
    const key = `${segment.kind}:${segment.sourceOffset}`;
    if (segment.kind === "markdown") {
      if (!segment.markdown.trim()) return null;
      return <View key={key}>{props.renderMarkdown(segment.markdown)}</View>;
    }
    return (
      <MarkdownRichFence
        key={key}
        kind={segment.kind}
        source={segment.source}
        renderSource={() => props.renderMarkdown(segment.markdown)}
      />
    );
  });
}
