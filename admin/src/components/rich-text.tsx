import { Fragment, type ReactNode } from "react";

/** Inline `**bold**` and `code`. Plain React, so model output can never inject markup. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-panel-2 px-1 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Renders the assistant's short answers: paragraphs, "-" bullet lists, bold and code. */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(<ul key={`l${blocks.length}`} className="my-1 list-disc space-y-0.5 pl-5">{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
      list = [];
    }
  };
  for (const line of text.split("\n")) {
    const item = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (item) list.push(item[1]);
    else {
      flush();
      if (line.trim()) blocks.push(<p key={`p${blocks.length}`} className="my-1">{inline(line)}</p>);
    }
  }
  flush();
  return <div className="break-words">{blocks}</div>;
}
