import { Head } from '@rspress/core/runtime';
import { Link, useLinkNavigate } from '@rspress/core/theme-original';
import { useSearchPanel } from '@rspress/core/dist/theme/components/Search/useSearchPanel.js';
import { SuggestItem } from '@rspress/core/dist/theme/components/Search/SuggestItem.js';
import '@rspress/core/dist/theme/components/Search/SearchPanel.css';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { containModalFocus } from './modal-focus';

interface SearchPanelProps { focused: boolean; setFocused: (value: boolean) => void }

/** Retain successful search engines; discard a failed engine and its fetch cache. */
export function SearchPanel({ focused, setFocused }: SearchPanelProps) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [value, setValue] = useState('');
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'KeyK' || !(event.ctrlKey || event.metaKey) || event.isComposing) return;
      event.preventDefault(); setFocused(!focused);
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [focused, setFocused]);
  useEffect(() => { if (!focused) setValue(''); }, [focused]);
  return (!failed || focused) && <SearchAttempt key={attempt} focused={focused} setFocused={setFocused}
    value={value} setValue={setValue} onFailureChange={setFailed} retry={() => setAttempt((previous) => previous + 1)} />;
}

/** Rspress 2.0.22 index/ranking, with locally owned recovery and modal behavior. */
function SearchAttempt({ focused, setFocused, value, setValue, onFailureChange, retry }: SearchPanelProps & {
  value: string; setValue: (value: string) => void; onFailureChange: (failed: boolean) => void; retry: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const search = useSearchPanel({ focused, searchInputRef: inputRef });
  const navigate = useLinkNavigate();
  const close = useCallback(() => setFocused(false), [setFocused]);
  useEffect(() => {
    if (search.initStatus === 'error') onFailureChange(true);
    if (search.initStatus === 'inited') {
      onFailureChange(false);
      // A retry preserves the input while replacing the engine's query state.
      if (value) search.handleQueryInput(value);
    }
  }, [search.initStatus, onFailureChange]);
  useEffect(() => {
    if (!focused) return;
    if (!modalRef.current) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const cleanup = containModalFocus(modalRef.current, close, origin);
    inputRef.current?.focus();
    return cleanup;
  }, [focused, close]);
  if (!search.searchEnabled) return null;
  // Never reuse stale suggestions during debounce, after clearing, or when closed.
  const suggestions = focused && value.trim() && value === search.query && !search.isSearching && search.currentRenderType === 'default'
    ? search.currentSuggestions : [];
  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (suggestions.length) search.setCurrentSuggestionIndex(
        (search.currentSuggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length
      );
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const selected = suggestions[search.currentSuggestionIndex];
    if (!inputRef.current?.value.trim() || !selected) return;
    void navigate(selected.link); close();
  };
  return <>
    {search.searchIndexURL && <Head><link rel="prefetch" href={search.searchIndexURL} /></Head>}
    {focused && createPortal(
      <div className="rp-search-panel__mask" onClick={close}>
        <div ref={modalRef} className="rp-search-panel__modal" role="dialog" aria-modal="true" aria-label="搜索文档"
          tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <div className="rp-search-panel__header">
            <div className="rp-search-panel__input-form">
              <input ref={inputRef} value={value} className="rp-search-panel__input" aria-label="搜索文档" placeholder="搜索文档"
                autoComplete="off" inputMode="search" onKeyDown={onInputKey}
                onChange={(event) => { setValue(event.target.value); search.handleQueryInput(event.target.value); }} />
              <button type="button" className="cg-search-clear" aria-label="清空搜索" onClick={() => {
                setValue('');
                search.clearQuery(); inputRef.current?.focus();
              }}>清空</button>
            </div>
            <button type="button" className="rp-search-panel__cancel" aria-label="关闭搜索" onClick={close}>关闭</button>
          </div>
          <div className="rp-search-panel__results rp-scrollbar" ref={resultsRef} aria-busy={search.isSearching}>
            {search.initStatus === 'error' ? <div className="cg-search-error" role="alert">
              <p>搜索索引加载失败：{search.searchError}。请检查网络后重试，或关闭后重新打开。</p>
              <button type="button" className="cg-search-retry" onClick={retry}>重试搜索</button>
            </div> : search.initStatus === 'initing' ? <p role="status">正在加载搜索…</p> :
              search.isSearching ? <p role="status">正在搜索…</p> : suggestions.length ?
              <ul className="rp-search-panel__group">{suggestions.map((suggestion, index) =>
                <SuggestItem key={`${suggestion.link}-${index}`} suggestion={suggestion} closeSearch={close} inCurrentDocIndex={true}
                  isCurrent={index === search.currentSuggestionIndex} setCurrentSuggestionIndex={() => search.setCurrentSuggestionIndex(index)}
                  onMouseMove={() => undefined} scrollTo={(offset, height) => {
                    const element = resultsRef.current;
                    if (element && (offset < element.scrollTop || offset + height > element.scrollTop + element.clientHeight)) element.scrollTop = offset - element.offsetTop;
                  }} />
              )}</ul> : <p role="status">{value.trim() ? '没有找到相关文档，请换一个关键词。' : '输入关键词查找文档。'}</p>}
            {search.initStatus === 'error' && <Link href="/">返回概览</Link>}
          </div>
        </div>
      </div>, document.getElementById('__rspress_modal_container') ?? document.body
    )}
  </>;
}
