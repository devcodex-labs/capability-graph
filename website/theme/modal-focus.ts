// Multiple modals may close out of order when a viewport change closes navigation
// under search. Retain isolation until every owner has released the element.
const isolation = new Map<HTMLElement, { previous: boolean; owners: number }>();

/** Isolate a modal without hiding its clickable mask; restore prior inert state. */
export function containModalFocus(root: HTMLElement, close: () => void, origin: HTMLElement | null) {
  const changed = new Set<HTMLElement>();
  const mask = document.querySelector('.rp-sidebar-menu__mask');
  let branch: HTMLElement = root;
  while (branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch || (mask && (sibling === mask || sibling.contains(mask)))) continue;
      const lock = isolation.get(sibling) ?? { previous: sibling.inert, owners: 0 };
      lock.owners++;
      isolation.set(sibling, lock);
      changed.add(sibling);
      sibling.inert = true;
    }
    branch = branch.parentElement;
    if (branch === document.body) break;
  }
  const focusable = () => Array.from(root.querySelectorAll<HTMLElement>(
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
  )).filter((element) => element.getClientRects().length && !element.closest('[hidden], [inert]'));
  const onKey = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key !== 'Tab') return;
    const items = focusable();
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) { event.preventDefault(); root.focus(); }
    else if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  };
  root.addEventListener('keydown', onKey);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    root.removeEventListener('keydown', onKey);
    changed.forEach((element) => {
      const lock = isolation.get(element)!;
      if (--lock.owners === 0) {
        element.inert = lock.previous;
        isolation.delete(element);
      }
    });
    if (origin?.isConnected && origin.getClientRects().length && !origin.closest('[inert]')) origin.focus({ preventScroll: true });
  };
}
