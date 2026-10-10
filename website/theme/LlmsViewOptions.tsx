import { useEffect, useId, useRef, useState } from 'react';
import { useSite, withSiteOrigin } from '@rspress/core/runtime';
import { copyToClipboard, useMdUrl, type LlmsViewOptionsProps } from '@rspress/core/theme-original';

/** A non-modal disclosure: a named trigger and sibling links/buttons, with native keyboard actions. */
export function LlmsViewOptions({ options: propsOptions }: LlmsViewOptionsProps) {
  const { site } = useSite();
  const { pathname } = useMdUrl();
  const url = withSiteOrigin(pathname);
  const query = `Read ${url}, I want to ask questions about it.`;
  const configured = site.themeConfig.llmsUI;
  const options = typeof configured === 'object' ? configured.viewOptions : propsOptions;
  const choices = options === false ? [] : options ?? ['markdownLink', 'chatgpt', 'claude'];
  const defaults = {
    markdownLink: { title: '复制 Markdown 链接', onClick: () => copyToClipboard(url) },
    chatgpt: { title: '在 ChatGPT 中打开', href: `https://chatgpt.com/?${new URLSearchParams({ hints: 'search', q: query })}` },
    claude: { title: '在 Claude 中打开', href: `https://claude.ai/new?${new URLSearchParams({ q: query })}` },
  };
  const items = choices.map((choice) => typeof choice === 'string' ? defaults[choice as keyof typeof defaults] : choice).filter(Boolean);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  if (!items.length) return null;
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div className="cg-document-options" ref={root} onKeyDown={(event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
  }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="rp-llms-button rp-llms-view-options__trigger"
      aria-label="更多文档选项" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>⌄</button>
    <ul id={id} className="cg-document-options-list" hidden={!open} aria-label="文档选项">
      {items.map((item) => <li key={item.title}>{'href' in item
        ? <a href={item.href} target="_blank" rel="noopener noreferrer">{item.title}</a>
        : <button type="button" onClick={() => { item.onClick?.(); close(); }}>{item.title}</button>}</li>)}
    </ul>
  </div>;
}
