import { describe, expect, it } from "vite-plus/test";

import {
  richPreviewDocument,
  richPreviewKind,
  sanitizedSvgMarkup,
  splitMarkdownRichFences,
} from "./markdownPreview.ts";

const document = (kind: "svg" | "html", source: string) =>
  richPreviewDocument(kind, source, "dark");

describe("rich preview sanitizing", () => {
  it("keeps a drawing and drops scripts, handlers, and foreign content", () => {
    const preview = document(
      "svg",
      `<svg viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="4" fill="currentColor" onclick="alert(1)" /><foreignObject><iframe src="https://evil.test"></iframe>secret</foreignObject></svg>`,
    );
    expect(preview).toContain("<circle");
    expect(preview).toContain('fill="currentColor"');
    expect(preview).not.toContain("<script");
    expect(preview).not.toContain("alert");
    expect(preview).not.toContain("onclick");
    expect(preview).not.toContain("foreignObject");
    expect(preview).not.toContain("secret");
    expect(preview).not.toContain("evil.test");
    expect(preview).toContain("default-src 'none'");
  });

  it("keeps fragment paint references and drops external ones", () => {
    const preview = sanitizedSvgMarkup(
      `<svg><defs><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#grad)" width="10" height="10"/><use href="#grad"/><use href="https://evil.test/x.svg#a"/><use href="/local.svg#a"/></svg>`,
    );
    expect(preview).toContain('id="grad"');
    expect(preview).toContain("url(#grad)");
    expect(preview).toContain('href="#grad"');
    expect(preview).not.toContain("evil.test");
    expect(preview).not.toContain("local.svg");
  });

  it("renders HTML text and inline styles without active content", () => {
    const preview = document(
      "html",
      `<div style="color:red;background:url(https://evil.test/p.png)">Hello</div><img src="https://evil.test/a.png" onerror="alert(1)"><img src="data:image/svg+xml;base64,PHN2Zy8+"><img src="data:image/png;base64,aaaa"><a href="https://example.com">Example</a><a href="/settings">Settings</a><script>alert(1)</script>`,
    );
    expect(preview).toContain("Hello");
    expect(preview).toContain("color:red");
    expect(preview).toContain("background:none");
    expect(preview).toContain("data:image/png;base64,aaaa");
    expect(preview).toContain("Example");
    expect(preview).toContain("Settings");
    expect(preview).not.toContain("href=");
    expect(preview).not.toContain("example.com");
    expect(preview).not.toContain("/settings");
    expect(preview).not.toContain("evil.test");
    expect(preview).not.toContain("onerror");
    expect(preview).not.toContain("<script");
    expect(preview).not.toContain("image/svg+xml");
  });

  it("does not let a style closer inject markup", () => {
    const preview = document(
      "html",
      `<style>a{content:"</style><img src=x onerror=alert(1)><b>Kept</b>`,
    );
    expect(preview).toContain("Kept");
    expect(preview).not.toContain("onerror");
    expect(preview).not.toContain("alert");
    expect(preview).not.toContain("<img");
    const styled = document("html", `<div style="content: '<b>x</b>'">Kept</div>`);
    expect(styled).toContain("Kept");
    expect(styled).toContain("\\3C ");
    expect(styled).not.toContain("<b>");
  });

  it("returns nothing for a block that is only a script", () => {
    expect(document("html", "<script>alert(1)</script>")).toBeNull();
    expect(sanitizedSvgMarkup("<div>Not a drawing</div>")).toBeNull();
  });
});

describe("rich preview fences", () => {
  it("recognizes svg and html languages", () => {
    expect(richPreviewKind("SVG")).toBe("svg");
    expect(richPreviewKind("htm")).toBe("html");
    expect(richPreviewKind("mermaid")).toBeNull();
  });

  it("splits closed top-level fences and leaves open or nested ones as markdown", () => {
    const markdown = [
      "Before",
      "",
      "```svg",
      "<svg></svg>",
      "```",
      "",
      "```html",
      "<b>Hi</b>",
      "```",
      "",
      "> ```html",
      "> <b>Quoted</b>",
      "> ```",
      "",
      "```HTML",
      "<i>open",
    ].join("\n");
    expect(splitMarkdownRichFences(markdown)).toMatchObject([
      { kind: "markdown", sourceOffset: 0 },
      { kind: "svg", source: "<svg></svg>" },
      { kind: "markdown" },
      { kind: "html", source: "<b>Hi</b>" },
      { kind: "markdown" },
    ]);
    const segments = splitMarkdownRichFences(markdown);
    const trailing = segments[4];
    expect(trailing?.kind === "markdown" && trailing.markdown).toContain("> ```html");
    expect(trailing?.kind === "markdown" && trailing.markdown).toContain("```HTML");
    expect(splitMarkdownRichFences("No fences here")).toEqual([
      { kind: "markdown", markdown: "No fences here", sourceOffset: 0 },
    ]);
  });
});
