import { CalIcon } from './icons';

export type MobileTab = 'today' | 'calendar';

interface Props {
  tab: MobileTab;
  onTab: (tab: MobileTab) => void;
}

/** Todoist-style floating bottom tab bar (mobile shell only) */
export function MobileTabBar({ tab, onTab }: Props) {
  const today = new Date().getDate();

  const items: { id: MobileTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'today',
      label: 'Today',
      icon: <span className="tab-today-glyph">{today}</span>,
    },
    { id: 'calendar', label: 'Calendar', icon: <CalIcon size={20} /> },
  ];

  const activeIndex = Math.max(
    items.findIndex((i) => i.id === tab),
    0,
  );

  return (
    <nav className="tabbar" aria-label="Main">
      <span
        className="tab-pill"
        aria-hidden="true"
        style={{ transform: `translateX(calc(${activeIndex} * (100% + 4px)))` }}
      />
      {items.map((item) => (
        <button
          key={item.id}
          className={`tab-item${tab === item.id ? ' is-active' : ''}`}
          aria-current={tab === item.id ? 'page' : undefined}
          onClick={() => onTab(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
