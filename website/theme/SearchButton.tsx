import { useI18n } from '@rspress/core/runtime';
import { IconSearch, SvgWrapper } from '@rspress/core/theme-original';
import { useEffect, useState } from 'react';
import '@rspress/core/dist/theme/components/Search/SearchButton.css';

export interface SearchButtonProps {
  setFocused: (focused: boolean) => void;
}

/** Keep the default visuals while making both search entrypoints real buttons. */
export function SearchButton({ setFocused }: SearchButtonProps) {
  const [metaKey, setMetaKey] = useState<string | null>(null);
  const t = useI18n();

  useEffect(() => {
    setMetaKey(/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform) ? '⌘' : 'Ctrl');
  }, []);

  const label = t('searchPlaceholderText');
  return (
    <>
      <button
        type="button"
        className="rp-search-button"
        aria-label={label}
        onClick={() => setFocused(true)}
      >
        <div className="rp-search-button__content">
          <SvgWrapper icon={IconSearch} className="rp-search-button__icon" />
          <span className="rp-search-button__word">{label}</span>
        </div>
        <div
          aria-hidden="true"
          className="rp-search-button__hotkey"
          style={{ opacity: metaKey ? 1 : 0 }}
        >
          <span>{metaKey}</span>
          <span>K</span>
        </div>
      </button>
      <button
        type="button"
        className="rp-search-button--mobile"
        aria-label={label}
        onClick={() => setFocused(true)}
      >
        <SvgWrapper icon={IconSearch} />
      </button>
    </>
  );
}
