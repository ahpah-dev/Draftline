import React, { useState, useCallback, useMemo } from "react";
import { Check, Copy } from "lucide-react";

type CodeToken = {
  type:
    | "comment"
    | "string"
    | "keyword"
    | "boolean"
    | "number"
    | "type"
    | "function"
    | "diff-add"
    | "diff-del"
    | "diff-info"
    | "text";
  text: string;
};

function tokenizeCode(code: string, lang: string): CodeToken[] {
  const normalizedLang = (lang || "").toLowerCase().trim();

  if (normalizedLang === "diff" || normalizedLang === "patch") {
    const lines = code.split("\n");
    return lines.map((line, idx) => {
      const isLast = idx === lines.length - 1;
      const text = line + (isLast ? "" : "\n");
      if (line.startsWith("+")) return { type: "diff-add", text };
      if (line.startsWith("-")) return { type: "diff-del", text };
      if (line.startsWith("@")) return { type: "diff-info", text };
      return { type: "text", text };
    });
  }

  const isHashComment = [
    "python",
    "py",
    "bash",
    "sh",
    "zsh",
    "shell",
    "yaml",
    "yml",
    "dockerfile",
  ].includes(normalizedLang);
  const commentPattern = isHashComment
    ? /(#[^\n]*)/
    : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/;

  const masterRegex = new RegExp(
    [
      commentPattern.source,
      /("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)/
        .source,
      /\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|import|export|from|as|default|class|extends|implements|interface|type|new|this|super|async|await|try|catch|finally|throw|def|lambda|with|pass|raise|except|fn|pub|struct|impl|mut|match|enum|package|func|select|go|defer)\b/
        .source,
      /\b(true|false|null|undefined|None|True|False|nil)\b/.source,
      /\b(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b/.source,
      /\b(string|number|boolean|any|void|unknown|never|Promise|Array|Record|int|float|str|bool|dict|list)\b/
        .source,
      /\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\s*\()/.source,
    ].join("|"),
    "g",
  );

  const tokens: CodeToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = masterRegex.exec(code)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: code.slice(lastIndex, match.index) });
    }
    const val = match[0];
    if (match[1]) tokens.push({ type: "comment", text: val });
    else if (match[2]) tokens.push({ type: "string", text: val });
    else if (match[3]) tokens.push({ type: "keyword", text: val });
    else if (match[4]) tokens.push({ type: "boolean", text: val });
    else if (match[5]) tokens.push({ type: "number", text: val });
    else if (match[6]) tokens.push({ type: "type", text: val });
    else if (match[7]) tokens.push({ type: "function", text: val });
    lastIndex = masterRegex.lastIndex;
  }
  if (lastIndex < code.length) {
    tokens.push({ type: "text", text: code.slice(lastIndex) });
  }
  return tokens;
}

const CodeBlock = React.memo(function CodeBlock({
  lang,
  meta,
  code,
}: {
  lang: string;
  meta: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  const tokens = useMemo(() => tokenizeCode(code, lang), [code, lang]);

  const displayLang = (lang || (meta ? "" : "text")).toLowerCase();

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <div className="md-code-title">
          {displayLang && <span className="md-code-lang">{displayLang}</span>}
          {meta && <span className="md-code-meta">{meta}</span>}
        </div>
        <button
          type="button"
          className={`md-code-copy ${copied ? "copied" : ""}`}
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="md-code-pre">
        <code>
          {tokens.map((tok, i) => (
            <span key={i} className={`tok-${tok.type}`}>
              {tok.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
});

type InlineToken =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; text: string; href: string }
  | { type: "bold_italic"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "strike"; value: string };

function parseInline(text: string): InlineToken[] {
  const pattern =
    /(`[^`\n]+`)|(\[[^\]]+\]\([^\)]+\))|(\*\*\*[^*]+\*\*\*)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(~~[^~]+~~)/g;

  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    const full = match[0];
    if (match[1]) {
      tokens.push({ type: "code", value: full.slice(1, -1) });
    } else if (match[2]) {
      const linkMatch = full.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        tokens.push({ type: "link", text: linkMatch[1], href: linkMatch[2] });
      } else {
        tokens.push({ type: "text", value: full });
      }
    } else if (match[3]) {
      tokens.push({ type: "bold_italic", value: full.slice(3, -3) });
    } else if (match[4]) {
      tokens.push({ type: "bold", value: full.slice(2, -2) });
    } else if (match[5]) {
      tokens.push({ type: "italic", value: full.slice(1, -1) });
    } else if (match[6]) {
      tokens.push({ type: "strike", value: full.slice(2, -2) });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }
  return tokens;
}

function RenderInline({ text }: { text: string }) {
  const tokens = useMemo(() => parseInline(text), [text]);

  return (
    <>
      {tokens.map((tok, i) => {
        switch (tok.type) {
          case "code":
            return (
              <code key={i} className="md-inline-code">
                {tok.value}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={tok.href}
                className="md-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                {tok.text}
              </a>
            );
          case "bold_italic":
            return (
              <strong key={i} className="md-strong md-em">
                {tok.value}
              </strong>
            );
          case "bold":
            return (
              <strong key={i} className="md-strong">
                {tok.value}
              </strong>
            );
          case "italic":
            return (
              <em key={i} className="md-em">
                {tok.value}
              </em>
            );
          case "strike":
            return (
              <del key={i} className="md-del">
                {tok.value}
              </del>
            );
          default:
            return <React.Fragment key={i}>{tok.value}</React.Fragment>;
        }
      })}
    </>
  );
}

type MarkdownBlock =
  | { type: "code"; lang: string; meta: string; code: string }
  | { type: "heading"; level: number; text: string }
  | { type: "blockquote"; text: string }
  | {
      type: "list";
      ordered: boolean;
      items: { indent: number; checked: boolean | null; text: string }[];
    }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "paragraph"; text: string };

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```([a-zA-Z0-9_\-+]*)(?:\s+(.*))?$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "";
      const meta = fenceMatch[2] || "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith("```")) {
        i++;
      }
      blocks.push({
        type: "code",
        lang,
        meta,
        code: codeLines.join("\n"),
      });
      continue;
    }

    // Horizontal rule
    if (/^(?:---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({
        type: "blockquote",
        text: quoteLines.join("\n"),
      });
      continue;
    }

    // Table
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s\-:|]+\|?\s*$/.test(lines[i + 1])
    ) {
      const headerLine = line;
      const headers = headerLine
        .split("|")
        .map((s) => s.trim())
        .filter(
          (s, idx, arr) => (idx > 0 && idx < arr.length - 1) || arr.length <= 2,
        );
      i += 2;
      const rows: string[][] = [];
      while (
        i < lines.length &&
        lines[i].includes("|") &&
        lines[i].trim() !== ""
      ) {
        const cells = lines[i]
          .split("|")
          .map((s) => s.trim())
          .filter(
            (s, idx, arr) =>
              (idx > 0 && idx < arr.length - 1) || arr.length <= 2,
          );
        rows.push(cells);
        i++;
      }
      blocks.push({
        type: "table",
        headers,
        rows,
      });
      continue;
    }

    // List
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const items: { indent: number; checked: boolean | null; text: string }[] =
        [];
      const ordered = /^\d+\./.test(listMatch[2]);
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!itemMatch) {
          if (lines[i].trim() === "") break;
          if (lines[i].startsWith("  ") && items.length > 0) {
            items[items.length - 1].text += "\n" + lines[i].trim();
            i++;
            continue;
          }
          break;
        }
        const taskMatch = itemMatch[3].match(/^\[([ xX])\]\s+(.*)$/);
        items.push({
          indent: itemMatch[1].length,
          checked: taskMatch ? taskMatch[1].toLowerCase() === "x" : null,
          text: taskMatch ? taskMatch[2] : itemMatch[3],
        });
        i++;
      }
      blocks.push({
        type: "list",
        ordered,
        items,
      });
      continue;
    }

    // Empty lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith(">") &&
      !lines[i].match(/^(\s*)([-*+]|\d+\.)\s+/) &&
      !/^(?:---|\*\*\*|___)\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({
      type: "paragraph",
      text: paraLines.join("\n"),
    });
  }

  return blocks;
}

export const FormattedText = React.memo(function FormattedText({
  content,
}: {
  content: string;
}) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  return (
    <div className="message-text">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "code":
            return (
              <CodeBlock
                key={i}
                lang={block.lang}
                meta={block.meta}
                code={block.code}
              />
            );
          case "heading": {
            const HeadingTag = `h${Math.min(block.level + 1, 6)}` as
              "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
            return (
              <HeadingTag key={i} className={`md-h${block.level}`}>
                <RenderInline text={block.text} />
              </HeadingTag>
            );
          }
          case "blockquote":
            return (
              <blockquote key={i} className="md-blockquote">
                <RenderInline text={block.text} />
              </blockquote>
            );
          case "table":
            return (
              <div key={i} className="md-table-wrap">
                <table className="md-table">
                  <thead>
                    <tr>
                      {block.headers.map((h, hi) => (
                        <th key={hi}>
                          <RenderInline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci}>
                            <RenderInline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <ListTag key={i} className={block.ordered ? "md-ol" : "md-ul"}>
                {block.items.map((item, itemIdx) => (
                  <li
                    key={itemIdx}
                    className={`md-li ${item.checked !== null ? "md-task-item" : ""}`}
                    style={
                      item.indent > 0
                        ? { marginLeft: `${item.indent * 8}px` }
                        : undefined
                    }
                  >
                    {item.checked !== null && (
                      <input
                        type="checkbox"
                        checked={item.checked}
                        readOnly
                        className="md-task-checkbox"
                        aria-label="Task item status"
                      />
                    )}
                    <span>
                      <RenderInline text={item.text} />
                    </span>
                  </li>
                ))}
              </ListTag>
            );
          }
          case "hr":
            return <hr key={i} className="md-hr" />;
          case "paragraph":
            return (
              <p key={i} className="md-p">
                {block.text.split("\n").map((line, lineIdx) => (
                  <React.Fragment key={lineIdx}>
                    {lineIdx > 0 && <br />}
                    <RenderInline text={line} />
                  </React.Fragment>
                ))}
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
});

export default FormattedText;
