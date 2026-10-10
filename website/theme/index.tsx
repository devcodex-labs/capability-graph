import './index.css';

import { Children, isValidElement } from 'react';
import { Layout as OriginalLayout, LlmsHint as OriginalLlmsHint, type LayoutProps, type RootProps } from '@rspress/core/theme-original';
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
export { LlmsViewOptions } from './LlmsViewOptions';
export { getCustomMDXComponent } from './DocComponents';

// Rspress App imports the original hint directly; Root is its public wrapper hook.
export function Root({ children }: RootProps) {
  return <>{Children.map(children, (child) => isValidElement(child) && child.type === OriginalLlmsHint
    ? <aside aria-label="机器可读文档索引">{child}</aside> : child)}</>;
}

export * from '@rspress/core/theme-original';
