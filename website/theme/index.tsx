import './index.css';
import { useContext, useEffect, useRef, useState } from 'react';
import { NoSSR, ThemeContext } from '@rspress/core/runtime';
import { IconMoon, IconSun, IconSearch, SearchPanel, SvgWrapper } from '@rspress/core/theme-original';
export * from '@rspress/core/theme-original';

/** Keep Rspress theme persistence while making its appearance control keyboard accessible. */
export function SwitchAppearance({ onClick }: { onClick?: () => void }) {
  const { theme, setTheme } = useContext(ThemeContext);
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      role="switch"
      aria-label="深色模式"
      aria-checked={dark}
      title={dark ? '切换到浅色模式' : '切换到深色模式'}
      className="cg-theme-toggle"
      onClick={() => { setTheme?.(dark ? 'light' : 'dark'); onClick?.(); }}
    >
      <SvgWrapper icon={dark ? IconMoon : IconSun} fill="currentColor" />
    </button>
  );
}

/** Native search owns indexing and keyboard commands; restore its trigger on dismissal. */
export function Search() {
  const [focused, setFocused] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const changeFocus = (next: boolean) => {
    setFocused(next);
    if (!next) requestAnimationFrame(() => trigger.current?.focus());
  };
  // Rspress 2.0.19 handles Enter even when its panel is closed/has no result.
  // Mount it only while open; retain the documented shortcut in this trigger.
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.code === 'KeyK' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        changeFocus(!focused);
      }
    };
    document.addEventListener('keydown', shortcut, true);
    return () => document.removeEventListener('keydown', shortcut, true);
  }, [focused]);
  return (
    <span onKeyDownCapture={event => {
      if (event.nativeEvent.isComposing) return;
      const panel = (event.target as Element).closest('.rp-search-panel__modal');
      if (!panel) {
        if (event.code === 'Enter') event.stopPropagation();
        return;
      }
      const empty = !panel.querySelector('.rp-suggest-item__link');
      const noSelection = !panel.querySelector('.rp-suggest-item--current');
      if ((event.code === 'Enter' && noSelection) ||
          (empty && (event.code === 'ArrowUp' || event.code === 'ArrowDown'))) {
        event.preventDefault();
        event.stopPropagation();
      }
    }}>
      <button type="button" ref={trigger} className="cg-search-button" aria-label="搜索文档" aria-haspopup="dialog" aria-expanded={focused} onClick={() => changeFocus(true)}>
        <SvgWrapper icon={IconSearch} />
        <span className="cg-search-label">搜索</span>
        <kbd>Ctrl K</kbd>
      </button>
      <NoSSR>{focused && <SearchPanel focused={focused} setFocused={changeFocus} />}</NoSSR>
    </span>
  );
}
