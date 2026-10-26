"use client";

import { useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { playUiSound } from "../../lib/ui-sounds";

type Task = {
  id: string | number;
  name: string | null;
};

type DashboardProps = {
  tasks: Task[];
  taskCount: number;
  dataError: string | null;
  dateLabel: string;
};

type IconName =
  | "grid"
  | "bot"
  | "plug"
  | "activity"
  | "settings"
  | "search"
  | "bell"
  | "chevron"
  | "arrow"
  | "clock"
  | "zap"
  | "more"
  | "volume"
  | "check"
  | "spark";

const iconPaths: Record<IconName, ReactNode> = {
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1" /><rect x="13.5" y="3.5" width="7" height="7" rx="1" /><rect x="3.5" y="13.5" width="7" height="7" rx="1" /><rect x="13.5" y="13.5" width="7" height="7" rx="1" /></>,
  bot: <><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6M2 12h2M20 12h2" /></>,
  plug: <><path d="M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-5 5h0a5 5 0 0 1-5-5V7Zm5 9v5" /></>,
  activity: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z" transform="translate(-1 -1) scale(1.08)" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></>,
  chevron: <path d="m9 18 6-6-6-6" />,
  arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  zap: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  volume: <><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M17 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  spark: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" /><path d="m19 14 1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1 1-2.5Z" /></>,
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  );
}

const navigation: { label: string; icon: IconName; tag?: string }[] = [
  { label: "Overview", icon: "grid" },
  { label: "Agents", icon: "bot", tag: "04" },
  { label: "Integrations", icon: "plug" },
  { label: "Activity", icon: "activity" },
];

const metrics = [
  { label: "Tasks processed", value: "2,846", change: "+12.8%", icon: "activity" as const, tint: "orange" },
  { label: "Active agents", value: "08", change: "All systems go", icon: "bot" as const, tint: "aqua" },
  { label: "Avg. response", value: "1.24s", change: "−0.18s this week", icon: "clock" as const, tint: "aqua" },
  { label: "Automation rate", value: "94.6%", change: "+4.2% this week", icon: "zap" as const, tint: "orange" },
];

const chartPaths: Record<string, string> = {
  "1H": "M0 119 C30 115 32 84 61 91 S92 130 118 98 147 106 174 70 205 83 232 78 262 35 289 57 321 62 348 42 376 62 406 33 436 45 462 17 493 31 522 19 552 23 583 7 612 15 642 5 676 10 707 1",
  "24H": "M0 108 C30 100 39 106 66 91 S103 87 127 96 161 55 188 69 223 54 247 61 278 35 305 49 333 40 359 53 384 30 412 39 437 49 463 28 490 36 516 17 543 29 569 14 594 28 624 11 651 20 679 5 707 12",
  "7D": "M0 113 C31 108 38 75 65 84 S102 109 130 82 163 90 191 62 222 77 249 46 278 63 306 52 333 67 361 42 388 51 416 29 444 48 472 27 500 33 529 15 558 30 587 10 615 20 643 7 673 14 707 4",
};

export function Dashboard({ tasks, taskCount, dataError, dateLabel }: DashboardProps) {
  const [activeNav, setActiveNav] = useState("Overview");
  const [activeTab, setActiveTab] = useState("1H");
  const [agentLevel, setAgentLevel] = useState(68);
  const [automation, setAutomation] = useState(82);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [humanApproval, setHumanApproval] = useState(true);
  const [adaptiveLearning, setAdaptiveLearning] = useState(false);
  const [query, setQuery] = useState("");
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const handlePointerOver = (event: PointerEvent<HTMLElement>) => {
    if (!soundEnabled) return;
    const target = event.target instanceof Element ? event.target.closest("[data-sound]") : null;
    const previous = event.relatedTarget instanceof Element
      ? event.relatedTarget.closest("[data-sound]")
      : null;
    if (target && target !== previous) playUiSound("hover");
  };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (!soundEnabled) return;
    const target = event.target instanceof Element ? event.target.closest("[data-sound]") : null;
    if (target) playUiSound("click");
  };

  const filteredTasks = tasks.filter((task) =>
    (task.name ?? "Untitled task").toLowerCase().includes(query.toLowerCase()),
  );

  const knobStyle = {
    "--knob-turn": `${(agentLevel / 100) * 260 - 130}deg`,
    "--knob-progress": `${(agentLevel / 100) * 270}deg`,
  } as CSSProperties;

  return (
    <main className="app-frame" onPointerOver={handlePointerOver} onClick={handleClick}>
      <aside className="sidebar">
        <a className="brand" href="#overview" data-sound aria-label="GRAPE command center">
          <span className="brand-mark"><span /><span /><span /><span /></span>
          <span className="brand-name">GRAPE<span>AGENTS</span><small>COMMAND DECK <i>V 2.6.0</i></small></span>
        </a>
        <div className="workspace-select">
          <div className="workspace-avatar">N</div>
          <div className="workspace-copy"><span>WORKSPACE</span><strong>Northstar AI</strong></div>
          <Icon name="chevron" size={15} />
        </div>
        <div className="nav-label">CONTROL ROOM <span>01</span></div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              className={`nav-item ${activeNav === item.label ? "selected" : ""}`}
              key={item.label}
              onClick={() => setActiveNav(item.label)}
              data-sound
              aria-current={activeNav === item.label ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.tag && <span className="nav-tag">{item.tag}</span>}
              {activeNav === item.label && <span className="nav-glint" />}
            </button>
          ))}
        </nav>
        <div className="nav-label secondary-label">PREFERENCES <span>02</span></div>
        <button className={`nav-item ${activeNav === "Settings" ? "selected" : ""}`} onClick={() => setActiveNav("Settings")} data-sound>
          <Icon name="settings" /><span>Settings</span>
        </button>
        <div className="sidebar-spacer" />
        <div className="system-card">
          <div className="system-card-head"><span className="signal-dot" /> SAMPLE HEALTH <span>DEMO</span></div>
          <div className="system-card-value">99.98<span>%</span></div>
          <div className="system-card-caption">All systems operational</div>
          <div className="system-meter"><span /></div>
        </div>
        <button className="profile-button" onClick={() => setActionNotice("Account settings will be connected in a future update.")} data-sound>
          <span className="profile-avatar">JD</span>
          <span className="profile-details"><strong>Jordan Davis</strong><small>Administrator</small></span>
          <Icon name="more" size={18} />
        </button>
        <div className="sidebar-foot">GRAPE <span>© 2025</span></div>
      </aside>

      <section className="main-shell" id="overview">
        <header className="topbar">
          <div className="breadcrumb"><span>WORKSPACE</span><Icon name="chevron" size={13} /><strong>COMMAND CENTER</strong><span className="breadcrumb-slash">/</span><span className="breadcrumb-current">{activeNav.toUpperCase()}</span></div>
          <div className="topbar-actions">
            <label className="search-box">
              <Icon name="search" size={16} />
              <input aria-label="Search tasks" placeholder="Search tasks..." value={query} onChange={(event) => setQuery(event.target.value)} data-sound />
              <kbd>⌘ K</kbd>
            </label>
            <span className="topbar-divider" />
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setActionNotice("You’re all caught up. There are no new notifications.")} data-sound>
              <Icon name="bell" size={18} /><span />
            </button>
            <button className="topbar-status" onClick={() => setActionNotice("This is a UI preview. Agent execution will connect to backend APIs in a future update.")} data-sound><i /> UI READY</button>
          </div>
        </header>

        <div className="dashboard-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> SYSTEM OVERVIEW <span className="eyebrow-dot">·</span> <span>{dateLabel}</span></div>
              <h1>Command <span>Center</span><b className="heading-cursor">_</b></h1>
              <p>Every agent, every workflow. One clear picture.</p>
              {actionNotice && <div className="action-notice" role="status"><span>{actionNotice}</span><button onClick={() => setActionNotice(null)} aria-label="Dismiss message" data-sound>×</button></div>}
            </div>
            <div className="heading-actions">
              <button className="button button-quiet" onClick={() => setActiveTab("24H")} data-sound><Icon name="clock" size={15} /> Last 24 hours <Icon name="chevron" size={14} /></button>
              <button className="button button-primary" onClick={() => setActionNotice("Agent provisioning is not connected yet. This dashboard is ready for the future create-agent API.")} data-sound><Icon name="spark" size={15} /> Create agent</button>
            </div>
          </section>

          {dataError && (
            <div className="connection-notice" role="status">
              <span className="notice-indicator" />
              <div><strong>LIVE DATA UNAVAILABLE</strong><span>{dataError}</span></div>
              <span className="notice-mode">DEMO METRICS</span>
            </div>
          )}

          <section className="metric-grid" aria-label="System metrics">
            {metrics.map((metric, index) => (
              <article className={`metric-card metric-${metric.tint}`} key={metric.label}>
                <div className="metric-top"><span>{metric.label}</span><span className="metric-sample">SAMPLE</span><span className="metric-icon"><Icon name={metric.icon} size={16} /></span></div>
                <div className="metric-value">{metric.value}<span className="metric-index">0{index + 1}</span></div>
                <div className="metric-foot"><span className={`metric-change ${index === 2 ? "muted-change" : ""}`}><span className="change-arrow">{index === 2 ? "↘" : "↗"}</span> {metric.change}</span><span className="metric-period">vs last week</span></div>
                <span className="metric-sweep" />
              </article>
            ))}
          </section>

          <section className="content-grid">
            <article className="panel performance-panel">
              <div className="panel-heading">
                <div><div className="panel-kicker">SAMPLE TELEMETRY</div><h2>Execution volume <span className="live-pulse" /></h2></div>
                <div className="chart-tabs" role="tablist" aria-label="Chart time range">
                  {["1H", "24H", "7D"].map((tab) => (
                    <button role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} key={tab} onClick={() => setActiveTab(tab)} data-sound>{tab}</button>
                  ))}
                </div>
              </div>
              <div className="chart-legend"><span><i className="legend-orange" /> TASKS COMPLETED</span><span><i className="legend-aqua" /> AGENT ACTIVITY</span><strong>+18.4% <Icon name="arrow" size={12} /></strong></div>
              <div className="chart-wrap">
                <div className="chart-y-labels"><span>500</span><span>400</span><span>300</span><span>200</span><span>100</span><span>0</span></div>
                <svg className="performance-chart" viewBox="0 0 707 140" preserveAspectRatio="none" role="img" aria-label={`Execution volume chart for ${activeTab}`}>
                  <defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#ff6b24" stopOpacity=".25" /><stop offset="100%" stopColor="#ff6b24" stopOpacity="0" /></linearGradient><filter id="chart-glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
                  {[10, 37, 64, 91, 118].map((y) => <line key={y} x1="0" y1={y} x2="707" y2={y} className="chart-gridline" />)}
                  <path d={`${chartPaths[activeTab]} L707 140 L0 140 Z`} fill="url(#chart-fill)" />
                  <path d={chartPaths[activeTab]} className="chart-line chart-line-orange" filter="url(#chart-glow)" />
                  <path d="M0 129 C35 127 42 113 70 119 S101 120 130 107 163 112 191 99 222 105 250 90 280 103 307 89 336 93 363 80 393 91 420 74 450 80 477 63 507 75 534 56 565 69 590 51 620 62 650 43 676 51 707 36" className="chart-line chart-line-aqua" />
                  <circle cx="707" cy="10" r="3.5" className="chart-endpoint" />
                </svg>
                <div className="chart-x-labels"><span>09:00</span><span>10:00</span><span>11:00</span><span>12:00</span><span>13:00</span><span>14:00</span><span>15:00</span></div>
              </div>
              <div className="chart-footer"><span><i /> SAMPLE STREAM</span><span>STATIC PREVIEW <b>·</b> DEMO VALUES</span></div>
            </article>

            <article className="panel agents-panel">
              <div className="panel-heading">
                <div><div className="panel-kicker">SAMPLE FLEET</div><h2>Active agents <span className="agent-count">08</span></h2></div>
                <button className="icon-button panel-more" aria-label="More agent options" onClick={() => setActionNotice("Agent menu actions will be connected when the agent management API is available.")} data-sound><Icon name="more" /></button>
              </div>
              <div className="agent-list">
                {[["INVOICE FLOW", "Processing", "98.2%", "orange"], ["DATA SENTINEL", "Monitoring", "100%", "aqua"], ["LEAD SCOUT", "Processing", "87.4%", "orange"], ["SUPPORT COPILOT", "Standby", "—", "quiet"]].map(([name, status, success, tint], index) => (
                  <button className="agent-row" key={name} onClick={() => setActiveNav("Agents")} data-sound>
                    <span className={`agent-glyph glyph-${tint}`}><Icon name={index === 0 ? "plug" : index === 1 ? "activity" : index === 2 ? "search" : "bot"} size={15} /></span>
                    <span className="agent-info"><strong>{name}</strong><small><i className={`agent-dot dot-${tint}`} /> {status}</small></span>
                    <span className="agent-success">{success}<small>SUCCESS</small></span>
                    <Icon name="chevron" size={14} />
                  </button>
                ))}
              </div>
              <button className="text-link" onClick={() => setActiveNav("Agents")} data-sound>VIEW ALL AGENTS <Icon name="arrow" size={13} /></button>
            </article>
          </section>

          <section className="content-grid lower-grid">
            <article className="panel map-panel">
              <div className="panel-heading">
                <div><div className="panel-kicker">SAMPLE GLOBAL NETWORK</div><h2>Operations map <span className="live-label"><i /> DEMO</span></h2></div>
                <button className="button button-quiet map-filter" onClick={() => setActionNotice("Region filtering will be available when live operations data is connected.")} data-sound>ALL REGIONS <Icon name="chevron" size={13} /></button>
              </div>
              <div className="map-visual">
                <svg viewBox="0 0 720 225" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Live global operations map">
                  <defs><pattern id="map-dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.35" fill="#253541" /></pattern></defs>
                  <path className="map-land" d="m66 54 19-16 27 2 8 11 24-4 11 13-12 10-1 15-15 5-4 17-17 4-4 14-17 2-8-14-17-5-4-18-14-6 5-15-8-8 17-7Zm67 87 18 5 11 14-6 15-5 22-12 15-8-20-10-21 1-18-8-8Zm169-110 21-8 21 6 8 15-9 12-13 1-4 18-16 10-9-6-13 13-12-8-11 12-13-4 2-15 10-13-4-13 16-7 2-12 18-1Zm26 69 15-15 22-3 17 8 8 21-7 17-8 17-8 24-14 26-14-9-6-22-13-14 2-18-13-9 4-16Zm88-75 27-8 29 9 23-2 21 12 21-3 20 18-10 12-20 1-15 13-17-6-7 13-20 1-5-12-20 1-11-11-17-2-12-15-15-3Zm32 65 19-9 24 6 9 17-11 14-16 7-6 22-13-7-10-17-9-13Zm75 28 24-9 30 8 22 15-4 16-21 6-22-9-19 5-14-12Z" />
                  <path className="map-route" d="M143 79 Q213 22 292 77T438 66 576 84M301 79Q310 133 356 154T461 151M438 66Q493 38 576 84" />
                  {[[143, 79], [292, 77], [438, 66], [576, 84], [356, 154], [461, 151], [530, 161]].map(([cx, cy], index) => <g className={`map-node node-${index}`} key={`${cx}-${cy}`}><circle className="node-ring" cx={cx} cy={cy} r="9" /><circle className="node-core" cx={cx} cy={cy} r="3" /></g>)}
                </svg>
                <div className="map-scale"><span>LOW ACTIVITY</span><i /><i /><i /><i /><i /><span>HIGH</span></div>
                <div className="map-callout"><span className="callout-line" /><small>US EAST</small><strong>1,284 <span>OPS</span></strong><em>+8.6% <Icon name="arrow" size={10} /></em></div>
                <div className="map-coordinates">40° 42&apos; 46.8&quot; N&nbsp;&nbsp; 74° 00&apos; 21.6&quot; W</div>
              </div>
              <div className="region-strip">
                {[["NORTH AMERICA", "1,284", "38%"], ["EUROPE", "842", "26%"], ["ASIA PACIFIC", "620", "21%"], ["OTHER", "100", "15%"]].map(([region, value, share]) => <div className="region-item" key={region}><span>{region}</span><strong>{value}<small> OPS</small></strong><div className="region-bar"><i style={{ width: share } as CSSProperties} /></div></div>)}
              </div>
            </article>

            <article className="panel control-panel">
              <div className="panel-heading">
                <div><div className="panel-kicker">LOCAL PREVIEW</div><h2>Agent controls</h2></div>
                <button className="icon-button panel-more" aria-label="Agent control options" onClick={() => setActionNotice("Agent settings are local previews and are not saved to the backend.")} data-sound><Icon name="more" /></button>
              </div>
              <div className="control-content">
                <div className="knob-section">
                  <div className="knob-title">AUTONOMY LEVEL <span className="info-mark">i</span></div>
                  <button
                    className="knob-button"
                    style={knobStyle}
                    onClick={() => setAgentLevel((value) => value >= 100 ? 0 : Math.min(100, value + 5))}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                        event.preventDefault();
                        setAgentLevel((value) => Math.min(100, value + 2));
                      }
                      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                        event.preventDefault();
                        setAgentLevel((value) => Math.max(0, value - 2));
                      }
                    }}
                    aria-label={`Increase autonomy, currently ${agentLevel} percent`}
                    data-sound
                  ><span className="knob-ticks" /><span className="knob-face"><i /></span></button>
                  <div className="knob-value">{agentLevel}<span>%</span></div>
                  <div className="knob-label">BALANCED</div>
                </div>
                <div className="slider-section">
                  <div className="slider-heading"><label htmlFor="automation-range">AUTOMATION THRESHOLD</label><strong>{automation}<span>%</span></strong></div>
                  <input id="automation-range" className="range-control" style={{ "--range-fill": `${automation}%` } as CSSProperties} type="range" min="0" max="100" value={automation} onChange={(event) => setAutomation(Number(event.target.value))} data-sound />
                  <div className="slider-labels"><span>CONSERVATIVE</span><span>AGGRESSIVE</span></div>
                  <div className="control-divider" />
                  <div className="toggle-row"><span className="toggle-copy"><strong>Human approval</strong><small>Review high-impact actions</small></span><button className={`switch ${humanApproval ? "is-on" : ""}`} role="switch" aria-checked={humanApproval} aria-label="Human approval" onClick={() => setHumanApproval((enabled) => !enabled)} data-sound><i /></button></div>
                  <div className="toggle-row"><span className="toggle-copy"><strong>Adaptive learning</strong><small>Improve from outcomes</small></span><button className={`switch ${adaptiveLearning ? "is-on" : ""}`} role="switch" aria-checked={adaptiveLearning} aria-label="Adaptive learning" onClick={() => setAdaptiveLearning((enabled) => !enabled)} data-sound><i /></button></div>
                </div>
              </div>
              <div className="control-foot"><span><i /> CHANGES ARE NOT SAVED</span><button className="reset-button" onClick={() => { setAgentLevel(68); setAutomation(82); }} data-sound>RESET DEFAULTS</button></div>
            </article>
          </section>

          <section className="content-grid bottom-grid">
            <article className="panel activity-panel">
              <div className="panel-heading">
                <div><div className="panel-kicker">SAMPLE SYSTEM FEED</div><h2>Recent activity</h2></div>
                <button className="text-link" onClick={() => setActiveNav("Activity")} data-sound>FULL LOG <Icon name="arrow" size={13} /></button>
              </div>
              <div className="activity-list">
                {[
                  ["bot", "Invoice Flow", "completed an approval workflow", "2 min ago", "COMPLETED", "orange"],
                  ["plug", "Stripe integration", "synced 24 new transactions", "8 min ago", "SYNCED", "aqua"],
                  ["spark", "Lead Scout", "qualified 12 new prospects", "14 min ago", "COMPLETED", "orange"],
                ].map(([icon, name, description, time, status, tint]) => (
                  <div className="activity-row" key={name}><span className={`activity-icon activity-${tint}`}><Icon name={icon as IconName} size={14} /></span><div className="activity-copy"><strong>{name}</strong><span>{description}</span></div><span className={`activity-status status-${tint}`}>{status}</span><span className="activity-time">{time}</span></div>
                ))}
              </div>
            </article>
            <article className="panel tasks-panel">
              <div className="panel-heading">
                <div>                <div className="panel-kicker">SUPABASE TASKS</div><h2>Task queue <span className="task-count">{taskCount}</span></h2></div>
                <button className="text-link" onClick={() => setActiveNav("Activity")} data-sound>ALL TASKS <Icon name="arrow" size={13} /></button>
              </div>
              {dataError ? <div className="task-state task-error"><span className="state-dot" /> Awaiting database connection</div> : filteredTasks.length === 0 ? <div className="task-state"><span className="state-dot" /> {query ? "No tasks match your search." : "No tasks in the queue yet."}</div> : (
                <div className="task-list">{filteredTasks.slice(0, 4).map((task) => <div className="task-row" key={task.id}><span className="task-state-icon"><Icon name="check" size={13} /></span><span className="task-name">{task.name ?? "Untitled task"}</span><span className="task-state-label">SYNCED</span></div>)}</div>
              )}
            </article>
          </section>
          <footer className="dashboard-footer"><span>GRAPE COMMAND DECK <i>·</i> BUILD 2.6.0</span><span><i className={`footer-dot ${dataError ? "footer-offline" : ""}`} /> {dataError ? "SUPABASE OFFLINE" : "SUPABASE CONNECTED"} <b>·</b> SOUNDS {soundEnabled ? "ON" : "OFF"} <button onClick={() => setSoundEnabled((enabled) => !enabled)} aria-label={`${soundEnabled ? "Mute" : "Enable"} interface sounds`} aria-pressed={!soundEnabled} data-sound><Icon name="volume" size={13} /></button></span></footer>
        </div>
      </section>
    </main>
  );
}
