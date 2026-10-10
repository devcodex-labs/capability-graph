import { forwardRef, useEffect, useRef, useState, type ComponentProps } from 'react';
import { getCustomMDXComponent as originalComponents, Link } from '@rspress/core/theme-original';

function DocumentLink(props: ComponentProps<typeof Link>) {
  const hiddenAnchor = props.className?.includes('rp-header-anchor') &&
    (props['aria-hidden'] === true || props['aria-hidden'] === 'true');
  return <Link {...props} {...(hiddenAnchor ? { tabIndex: -1 } : {})} />;
}

const DocumentTable = forwardRef<HTMLTableElement, ComponentProps<'table'>>((props, ref) => {
  const container = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState<string>();
  useEffect(() => {
    const element = container.current!;
    const number = [...document.querySelectorAll('main .rp-table-scroll-container')].indexOf(element) + 1;
    const sync = () => {
      const overflow = element.scrollWidth > element.clientWidth + 1;
      const headers = [...element.querySelectorAll('th')].map((cell) => cell.textContent?.trim()).filter(Boolean).join('、');
      setLabel(overflow ? `表格 ${number}：${headers.slice(0, 120) || '数据'}，可横向滚动` : undefined);
    };
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    const table = element.querySelector('table');
    if (table) observer.observe(table);
    sync();
    return () => observer.disconnect();
  }, [props.children]);
  return <div ref={container} className="rp-table-scroll-container rp-scrollbar"
    tabIndex={label ? 0 : undefined} role={label ? 'region' : undefined} aria-label={label}
    onKeyDown={(event) => {
      if (!label || event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      // Native arrow scrolling can keep animating after a Home/End jump. Use one path for all horizontal keys.
      const element = event.currentTarget;
      element.scrollLeft = event.key === 'Home' ? 0 : event.key === 'End' ? element.scrollWidth - element.clientWidth
        : element.scrollLeft + (event.key === 'ArrowLeft' ? -40 : 40);
    }}>
    <table ref={ref} {...props} />
  </div>;
});

/** Public MDX extension point keeps native table semantics and hidden anchors out of Tab order. */
export function getCustomMDXComponent() {
  return { ...originalComponents(), a: DocumentLink, table: DocumentTable };
}
