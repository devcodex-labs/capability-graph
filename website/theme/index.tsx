import './index.css';

import { Layout as OriginalLayout, type LayoutProps } from '@rspress/core/theme-original';
import { AccessibleThemeBridge } from './AccessibleThemeBridge';

export function Layout(props: LayoutProps) {
  return (
    <>
      <AccessibleThemeBridge />
      <OriginalLayout {...props} />
    </>
  );
}

export { SearchButton } from './SearchButton';
export { SearchPanel } from './SearchPanel';
export { Sidebar } from './Sidebar';

export * from '@rspress/core/theme-original';
