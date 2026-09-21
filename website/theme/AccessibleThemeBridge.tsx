import { useEffect } from 'react';

type Cleanup = () => void;

/**
 * Rspress 2.0.22 hard-codes several control semantics below its public props.
 * This bridge is intentionally small and protected by browser tests so an
 * upstream markup change fails loudly instead of silently degrading access.
 */
export function AccessibleThemeBridge() {
  useEffect(() => {
    const cleanups = new Map<HTMLElement, Cleanup>();
    let lastSearchTrigger: HTMLElement | null = null;
    let searchWasOpen = false;

    const listen = <K extends keyof HTMLElementEventMap>(
      element: HTMLElement,
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void
    ) => {
      element.addEventListener(type, listener as EventListener);
      return () => element.removeEventListener(type, listener as EventListener);
    };

    const makeKeyboardClickable = (element: HTMLElement, activate: () => void) => {
      if (cleanups.has(element)) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      };
      cleanups.set(element, listen(element, 'keydown', onKeyDown));
    };

    const sync = () => {
      for (const [element, cleanup] of cleanups) {
        if (element.isConnected) continue;
        cleanup();
        cleanups.delete(element);
      }

      const searchOpen = Boolean(document.querySelector('.rp-search-panel__modal'));
      document.querySelectorAll<HTMLElement>('.rp-search-button, .rp-search-button--mobile').forEach((button) => {
        button.setAttribute('aria-expanded', String(searchOpen));
        if (cleanups.has(button)) return;
        const rememberTrigger = () => {
          lastSearchTrigger = button;
        };
        cleanups.set(button, listen(button, 'click', rememberTrigger));
      });

      document.querySelectorAll<HTMLElement>('.rp-nav-hamburger').forEach((button) => {
        const expanded = button.classList.contains('rp-nav-hamburger--active');
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-label', expanded ? '关闭站点菜单' : '打开站点菜单');
      });

      const sidebarButton = document.querySelector<HTMLElement>('.rp-sidebar-menu__left');
      if (sidebarButton?.tagName === 'BUTTON') {
        sidebarButton.setAttribute('aria-label', '文档导航');
        sidebarButton.setAttribute('aria-expanded', String(Boolean(document.querySelector('.rp-doc-layout__sidebar--open'))));
      }
      const outlineButton = document.querySelector<HTMLElement>('.rp-sidebar-menu__right');
      if (outlineButton?.tagName === 'BUTTON') {
        outlineButton.setAttribute('aria-label', '本页目录');
        outlineButton.setAttribute('aria-expanded', String(Boolean(document.querySelector('.rp-doc-layout__outline--open'))));
      }

      const modal = document.querySelector<HTMLElement>('.rp-search-panel__modal');
      if (modal) {
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', '搜索文档');
      }
      const input = document.querySelector<HTMLInputElement>('.rp-search-panel__input');
      input?.setAttribute('aria-label', '搜索文档');

      const cancel = document.querySelector<HTMLElement>('.rp-search-panel__cancel');
      if (cancel) {
        cancel.setAttribute('role', 'button');
        cancel.setAttribute('tabindex', '0');
        cancel.setAttribute('aria-label', '关闭搜索');
        makeKeyboardClickable(cancel, () => cancel.click());
      }

      const closeIcon = document.querySelector<HTMLElement>('.rp-search-panel__close');
      const closeControl = closeIcon?.closest<HTMLElement>('label');
      if (closeControl && closeIcon) {
        const updateCloseLabel = () => {
          closeControl.setAttribute('aria-label', input?.value ? '清空搜索' : '关闭搜索');
        };
        closeControl.setAttribute('role', 'button');
        closeControl.setAttribute('tabindex', '0');
        updateCloseLabel();
        if (!cleanups.has(closeControl)) {
          const removeKey = listen(closeControl, 'keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            closeIcon.click();
          });
          const removeInput = input ? listen(input, 'input', updateCloseLabel) : () => undefined;
          cleanups.set(closeControl, () => {
            removeKey();
            removeInput();
          });
        }
      }

      if (searchWasOpen && !searchOpen && lastSearchTrigger?.isConnected) {
        lastSearchTrigger.focus();
        lastSearchTrigger = null;
      }
      searchWasOpen = searchOpen;
    };

    const rememberShortcutOrigin = (event: KeyboardEvent) => {
      if (event.code === 'KeyK' && (event.ctrlKey || event.metaKey)) {
        lastSearchTrigger = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      }
    };
    document.addEventListener('keydown', rememberShortcutOrigin, true);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });
    sync();

    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', rememberShortcutOrigin, true);
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
    };
  }, []);

  return null;
}
