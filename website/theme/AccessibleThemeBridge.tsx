import { useEffect } from 'react';
import { containModalFocus } from './modal-focus';

/** Semantics for the remaining Rspress 2.0.22 header/mobile controls. */
export function AccessibleThemeBridge() {
  useEffect(() => {
    // Match Rspress's actual overlay layouts, rather than the header breakpoint.
    const mobileSidebar = window.matchMedia('(max-width: 768px)');
    const mobileOutline = window.matchMedia('(max-width: 1279px)');
    let sidebarCleanup: (() => void) | undefined;
    let activeSidebar: HTMLElement | undefined;
    let closingSidebar = false;
    const releaseSidebar = () => {
      sidebarCleanup?.(); sidebarCleanup = undefined;
      activeSidebar?.removeAttribute('role');
      activeSidebar?.removeAttribute('aria-modal');
      activeSidebar?.removeAttribute('aria-label');
      activeSidebar = undefined;
    };
    const sync = () => {
      const searchOpen = Boolean(document.querySelector('.rp-search-panel__modal'));
      document.querySelectorAll('.rp-search-button, .rp-search-button--mobile').forEach((button) => {
        button.setAttribute('aria-expanded', String(searchOpen));
      });
      document.querySelectorAll('.rp-nav-hamburger').forEach((button) => {
        const expanded = button.classList.contains('rp-nav-hamburger--active');
        button.setAttribute('aria-expanded', String(expanded));
        button.setAttribute('aria-label', expanded ? '关闭站点菜单' : '打开站点菜单');
      });
      const sidebarButton = document.querySelector<HTMLElement>('.rp-sidebar-menu__left');
      const layoutSidebar = document.querySelector<HTMLElement>('.rp-doc-layout__sidebar');
      const openSidebar = layoutSidebar?.classList.contains('rp-doc-layout__sidebar--open');
      const sidebar = mobileSidebar.matches && openSidebar ? layoutSidebar : null;
      sidebarButton?.setAttribute('aria-label', '文档导航');
      sidebarButton?.setAttribute('aria-expanded', String(Boolean(sidebar)));
      if (layoutSidebar) {
        layoutSidebar.id = 'cg-document-sidebar';
        sidebarButton?.setAttribute('aria-controls', layoutSidebar.id);
      }
      const outlineButton = document.querySelector<HTMLElement>('.rp-sidebar-menu__right');
      const outline = document.querySelector<HTMLElement>('.rp-doc-layout__outline');
      outlineButton?.setAttribute('aria-label', '本页目录');
      outlineButton?.setAttribute('aria-expanded', String(Boolean(mobileOutline.matches && outline?.classList.contains('rp-doc-layout__outline--open'))));
      if (outline) {
        outline.id = 'cg-page-outline';
        outline.setAttribute('aria-label', '本页目录');
        outlineButton?.setAttribute('aria-controls', outline.id);
      }
      if (activeSidebar && activeSidebar !== sidebar) releaseSidebar();
      if (sidebar && !sidebarCleanup) {
        activeSidebar = sidebar;
        sidebar.setAttribute('role', 'dialog');
        sidebar.setAttribute('aria-modal', 'true');
        sidebar.setAttribute('aria-label', '文档导航');
        sidebarCleanup = containModalFocus(sidebar, () => document.querySelector<HTMLElement>('.rp-sidebar-menu__mask')?.click(), sidebarButton ?? null);
        sidebar.querySelector<HTMLElement>('.cg-sidebar-close')?.focus();
      }
      // Use the existing React controls to release their body-scroll locks too.
      if (!openSidebar) closingSidebar = false;
      if (!mobileSidebar.matches && openSidebar && !closingSidebar) {
        closingSidebar = true;
        // The native trigger only opens; the mask owns the close callback.
        document.querySelector<HTMLElement>('.rp-sidebar-menu__mask')?.click();
      }
      if (!mobileOutline.matches && outline?.classList.contains('rp-doc-layout__outline--open')) outlineButton?.click();
    };
    const onKey = (event: KeyboardEvent) => {
      // The outline is a non-modal disclosure. Escape closes it from the page;
      // a foreground search/navigation modal owns its own Escape instead.
      if (event.key !== 'Escape' || event.isComposing || document.querySelector('.rp-search-panel__modal')) return;
      if (!mobileOutline.matches || !document.querySelector('.rp-doc-layout__outline--open')) return;
      const button = document.querySelector<HTMLElement>('.rp-sidebar-menu__right');
      event.preventDefault();
      button?.click(); button?.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    mobileSidebar.addEventListener('change', sync);
    mobileOutline.addEventListener('change', sync);
    document.addEventListener('keydown', onKey);
    sync();
    return () => {
      observer.disconnect(); releaseSidebar();
      mobileSidebar.removeEventListener('change', sync);
      mobileOutline.removeEventListener('change', sync);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return null;
}
