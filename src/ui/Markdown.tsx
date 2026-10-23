import { useMemo } from "react";
import { renderMarkdown } from "../lib/markdown";

export function Markdown(props: {
  markdown: string;
  onOpenLink: (url: string) => void;
}) {
  const html = useMemo(() => renderMarkdown(props.markdown), [props.markdown]);
  return (
    <div
      className="markdown"
      onClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const anchor = target.closest("a");
        if (!anchor) return;
        const href = anchor.getAttribute("href");
        if (!href) return;
        event.preventDefault();
        props.onOpenLink(href);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
