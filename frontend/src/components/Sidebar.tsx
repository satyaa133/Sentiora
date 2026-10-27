import { useState } from "react";
import type { ReactNode } from "react";

import {
  Drawer,
  IconButton,
  IconClock,
  IconEye,
  IconHome,
  IconLink,
  IconLogOut,
  IconMenu,
  IconMessage,
  IconSearch,
  IconShield,
  Logo,
  LogoMark,
  ThemeToggle,
  cx,
} from "@shared/ui";

import { useAuth } from "../context/AuthContext";

export type NavTab =
  | "dashboard"
  | "intelligence"
  | "timeline"
  | "search"
  | "ask"
  | "sources"
  | "privacy"
  | "settings";

interface NavItem {
  id: NavTab;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Home", icon: <IconHome /> },
  { id: "intelligence", label: "Intelligence", icon: <IconEye /> },
  { id: "timeline", label: "Timeline", icon: <IconClock /> },
  { id: "search", label: "Search", icon: <IconSearch /> },
  { id: "ask", label: "Ask Sentiora", icon: <IconMessage /> },
  { id: "sources", label: "Sources", icon: <IconLink /> },
  { id: "privacy", label: "Privacy", icon: <IconShield /> },
];

function useDisplayName() {
  const { user } = useAuth();
  const name =
    user?.profile?.display_name?.trim() || user?.email?.split("@")[0] || "You";
  return { name, initial: name.charAt(0).toUpperCase() };
}

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  /** Narrow icon-only rail (used by Ask Sentiora). */
  rail?: boolean;
}

/** Desktop navigation (lg and up). Phones use MobileTopBar. */
export default function Sidebar({
  activeTab,
  setActiveTab,
  rail = false,
}: SidebarProps) {
  const { logout } = useAuth();
  const { name, initial } = useDisplayName();

  return (
    <aside
      className={cx(
        "hidden h-full shrink-0 flex-col border-r border-line bg-surface lg:flex",
        rail ? "w-[76px] items-center px-3 py-5" : "w-64 px-4 py-5",
      )}
    >
      <div className={cx("mb-6", rail ? "flex justify-center" : "px-2")}>
        {rail ? <LogoMark size={28} title="Sentiora" /> : <Logo size={22} />}
      </div>

      <nav aria-label="Main" className="flex-1">
        <ul className={cx("space-y-1", rail && "flex flex-col items-center")}>
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  aria-current={active ? "page" : undefined}
                  aria-label={rail ? item.label : undefined}
                  title={rail ? item.label : undefined}
                  className={cx(
                    "flex items-center rounded-btn text-[16px] transition-colors",
                    rail ? "h-12 w-12 justify-center" : "h-11 w-full gap-3 px-3",
                    active
                      ? "bg-accent-soft font-semibold text-accent-soft-fg"
                      : "text-fg hover:bg-raised",
                  )}
                >
                  <span className={active ? "" : "text-muted"}>{item.icon}</span>
                  {rail ? null : item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        className={cx(
          "border-t border-line pt-4",
          rail ? "flex flex-col items-center gap-2" : "",
        )}
      >
        {rail ? (
          <>
            <ThemeToggle variant="icon" />
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              aria-label={`Settings for ${name}`}
              title="Settings"
              className={cx(
                "flex h-11 w-11 items-center justify-center rounded-full bg-raised font-semibold text-fg",
                activeTab === "settings" && "ring-2 ring-accent",
              )}
            >
              {initial}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 px-2">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raised font-semibold text-fg"
              >
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">{name}</p>
                <button
                  type="button"
                  onClick={() => setActiveTab("settings")}
                  aria-current={activeTab === "settings" ? "page" : undefined}
                  className={cx(
                    "text-[15px] hover:underline",
                    activeTab === "settings" ? "font-semibold text-link" : "text-muted",
                  )}
                >
                  Settings
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between px-1">
              <ThemeToggle variant="icon" />
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex h-11 items-center gap-2 rounded-btn px-3 text-[15px] text-muted hover:bg-raised hover:text-fg"
              >
                <IconLogOut size={18} />
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

interface MobileTopBarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  onOpenPalette: () => void;
}

/** Phone and tablet header (below lg): logo, search and a menu drawer. */
export function MobileTopBar({
  activeTab,
  setActiveTab,
  onOpenPalette,
}: MobileTopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { logout } = useAuth();
  const { name } = useDisplayName();

  function go(tab: NavTab) {
    setActiveTab(tab);
    setMenuOpen(false);
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-line bg-surface px-2 pl-4 lg:hidden">
      <Logo size={20} />
      <div className="flex items-center">
        <IconButton
          label="Search memories"
          icon={<IconSearch />}
          onClick={onOpenPalette}
        />
        <IconButton
          label="Open menu"
          icon={<IconMenu />}
          onClick={() => setMenuOpen(true)}
          aria-expanded={menuOpen}
        />
      </div>
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <nav aria-label="Main">
          <ul className="space-y-1">
            {[
              ...NAV_ITEMS,
              { id: "settings" as const, label: "Settings", icon: null },
            ].map((item) => {
              const active = activeTab === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => go(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex h-12 w-full items-center gap-3 rounded-btn px-3 text-[17px]",
                      active
                        ? "bg-accent-soft font-semibold text-accent-soft-fg"
                        : "text-fg hover:bg-raised",
                    )}
                  >
                    {item.icon ? (
                      <span className={active ? "" : "text-muted"}>{item.icon}</span>
                    ) : (
                      <span className="w-5" />
                    )}
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-6 space-y-4 border-t border-line pt-5">
          <ThemeToggle />
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-muted">{name}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex h-11 items-center gap-2 rounded-btn px-3 text-fg hover:bg-raised"
            >
              <IconLogOut size={18} />
              Sign out
            </button>
          </div>
        </div>
      </Drawer>
    </header>
  );
}
