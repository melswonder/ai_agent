"use client";

import clsx from "clsx";
import type { ReactNode } from "react";

type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; content: string }
  | { type: "paragraph"; content: string }
  | { type: "list"; items: string[] }
  | { type: "timeline"; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const BULLET_RE = /^[-*]\s+(.+)$/;
const ORDERED_RE = /^\d+\.\s+(.+)$/;
const TABLE_SEPARATOR_RE =
  /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+(?:\s*:?-{3,}:?\s*)\|?\s*$/;
const TIME_PREFIX_RE =
  /^(?:\*\*)?(\d{1,2}:\d{2}(?:\s*[-~]\s*\d{1,2}:\d{2})?)(?:\*\*)?(?:\s*[-:：]\s*|\s+)(.+)$/;

function isTableStart(lines: string[], index: number) {
  return (
    index + 1 < lines.length &&
    lines[index].includes("|") &&
    TABLE_SEPARATOR_RE.test(lines[index + 1])
  );
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTimelineItems(items: string[]) {
  return items.every((item) => TIME_PREFIX_RE.test(item));
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();

    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        content: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]);
      index += 2;
      const rows: string[][] = [];

      while (index < lines.length && lines[index].includes("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }

      blocks.push({ type: "table", headers, rows });
      continue;
    }

    if (BULLET_RE.test(line) || ORDERED_RE.test(line)) {
      const items: string[] = [];

      while (index < lines.length) {
        const current = lines[index].trim();
        const bulletMatch = current.match(BULLET_RE) ?? current.match(ORDERED_RE);
        if (!bulletMatch) {
          break;
        }
        items.push(bulletMatch[1].trim());
        index += 1;
      }

      blocks.push({
        type: isTimelineItems(items) ? "timeline" : "list",
        items,
      });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (
        !current ||
        current.match(HEADING_RE) ||
        isTableStart(lines, index) ||
        current.match(BULLET_RE) ||
        current.match(ORDERED_RE)
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }

    if (paragraphLines.length > 0) {
      blocks.push({
        type: "paragraph",
        content: paragraphLines.join(" "),
      });
      continue;
    }

    index += 1;
  }

  return blocks;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      tokens.push(
        <a
          key={`${match.index}-link`}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 transition hover:decoration-zinc-900"
        >
          {match[2]}
        </a>,
      );
    } else if (match[5]) {
      tokens.push(
        <strong key={`${match.index}-strong`} className="font-semibold text-zinc-900">
          {match[5]}
        </strong>,
      );
    } else if (match[7]) {
      tokens.push(
        <code
          key={`${match.index}-code`}
          className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.92em] text-zinc-700"
        >
          {match[7]}
        </code>,
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens;
}

function renderTimelineItem(item: string, index: number, isLast: boolean) {
  const match = item.match(TIME_PREFIX_RE);
  const time = match?.[1] ?? "";
  const body = match?.[2] ?? item;

  return (
    <div key={`${time}-${index}`} className="relative pl-6">
      {!isLast ? (
        <div className="absolute left-[7px] top-2 h-full w-px bg-zinc-200" />
      ) : null}
      <div className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border border-zinc-300 bg-white" />
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 px-4 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
          {time}
        </p>
        <div className="mt-2 text-sm leading-7 text-zinc-600">
          {renderInlineMarkdown(body)}
        </div>
      </div>
    </div>
  );
}

export function MarkdownMessage({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className={clsx("space-y-4", className)}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const sizeClass =
            block.level === 1
              ? "text-base"
              : block.level === 2
                ? "text-sm"
                : "text-[13px]";
          return (
            <h3
              key={`${block.type}-${index}`}
              className={clsx(
                "font-semibold uppercase tracking-[0.14em] text-zinc-900",
                sizeClass,
              )}
            >
              {renderInlineMarkdown(block.content)}
            </h3>
          );
        }

        if (block.type === "paragraph") {
          return (
            <p
              key={`${block.type}-${index}`}
              className="whitespace-pre-wrap text-[15px] leading-relaxed tracking-[0.01em] text-zinc-600"
            >
              {renderInlineMarkdown(block.content)}
            </p>
          );
        }

        if (block.type === "list") {
          return (
            <ul
              key={`${block.type}-${index}`}
              className="space-y-2 text-[15px] leading-relaxed tracking-[0.01em] text-zinc-600"
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${itemIndex}-${item}`} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300" />
                  <span>{renderInlineMarkdown(item)}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "timeline") {
          return (
            <div key={`${block.type}-${index}`} className="space-y-3">
              {block.items.map((item, itemIndex) =>
                renderTimelineItem(item, itemIndex, itemIndex === block.items.length - 1),
              )}
            </div>
          );
        }

        return (
          <div
            key={`${block.type}-${index}`}
            className="overflow-hidden rounded-2xl border border-zinc-200 bg-white"
          >
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-left">
                <thead className="bg-zinc-50">
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th
                        key={`${header}-${headerIndex}`}
                        className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400"
                      >
                        {renderInlineMarkdown(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${rowIndex}-${row.join("|")}`} className="align-top">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`${cellIndex}-${cell}`}
                          className="px-4 py-3 text-sm leading-7 text-zinc-600"
                        >
                          {renderInlineMarkdown(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
