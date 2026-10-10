import { useActiveMatcher, useSidebarDynamic } from '@rspress/core/runtime';
import { Link, Tag } from '@rspress/core/theme-original';
import type { SidebarData } from '@rspress/shared';
import '@rspress/core/dist/theme/components/Sidebar/SidebarItem.css';
import '@rspress/core/dist/theme/components/Sidebar/SidebarGroup.css';

function toggleGroup(items: SidebarData, indexes: number[]): SidebarData {
  return items.map((item, index) => index !== indexes[0] || !('items' in item) ? item : {
    ...item, ...(indexes.length === 1 ? { collapsed: !item.collapsed } : { items: toggleGroup(item.items, indexes.slice(1)) })
  });
}
export function Sidebar() {
  const [data, setData] = useSidebarDynamic();
  const active = useActiveMatcher();
  const renderItems = (items: SidebarData, parents: number[] = []) => items.map((item, index) => {
    const indexes = [...parents, index];
    const id = `cg-section-${indexes.join('-')}`;
    if ('dividerType' in item) return <hr key={id} />;
    if ('sectionHeaderText' in item) return <p key={id}>{item.sectionHeaderText}</p>;
    const group = 'items' in item;
    const current = Boolean(item.link && active(item.link));
    const link = <Link href={item.link ?? '#'} aria-current={current ? 'page' : undefined}
      className={`rp-sidebar-item${group ? ' rp-sidebar-group' : ''}${parents.length ? ' rp-sidebar-item--group-item' : ''}${current ? ' rp-sidebar-item--active' : ''}`}
      style={{ paddingLeft: `${12 * (parents.length + 1)}px` }}>
      <span>{item.text}</span><Tag tag={item.tag} />
    </Link>;
    if (!group) return <div key={id}>{link}</div>;
    return <section key={id} id={id} data-section={item.text}>
      <div className="cg-sidebar-heading">{link}
        {item.collapsible && <button type="button" aria-label={`${item.collapsed ? '展开' : '收起'}${item.text}`}
          aria-expanded={!item.collapsed} aria-controls={`${id}-items`}
          onClick={() => setData((previous) => toggleGroup(previous, indexes))}>
          <span aria-hidden="true">{item.collapsed ? '▸' : '▾'}</span>
        </button>}
      </div>
      <div id={`${id}-items`} hidden={item.collapsed}>{renderItems(item.items, indexes)}</div>
    </section>;
  });
  return <nav aria-label="文档导航">
    <div className="cg-sidebar-tools">
      <button type="button" className="cg-sidebar-close" aria-label="关闭文档导航"
        onClick={() => document.querySelector<HTMLElement>('.rp-sidebar-menu__mask')?.click()}>关闭导航</button>
      <label>跳转分区 <select aria-label="跳转分区" defaultValue="" onChange={(event) => {
        const id = event.target.value;
        const index = Number(id.slice('cg-section-'.length));
        setData((previous) => previous.map((item, position) => position === index && 'items' in item ? { ...item, collapsed: false } : item));
        const section = document.getElementById(id);
        section?.scrollIntoView({ block: 'start' });
        section?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
        event.target.value = '';
      }}>
        <option value="" disabled>选择分区</option>
        {data.map((item, index) => 'items' in item && <option key={index} value={`cg-section-${index}`}>{item.text}</option>)}
      </select></label>
    </div>
    {renderItems(data)}
  </nav>;
}
