import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Menu, Flex, Text, Box } from "@chakra-ui/react";
import { Search, Menu as MenuIcon, X, LogOut, Moon, Sun, Settings, Check, TriangleAlert, SquareArrowRightEnter } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { useColorMode } from "@/components/ui/color-mode";
import UserAvatar from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import { API_BASE, SettingsService } from "@/db";
import { TickerLogo } from "@/lib/sourceLogos";
import { DropdownItem } from "@/pages/shared/AnalysisControls";
import { cn } from "@/lib/utils";
import searxngLogo from "@/assets/searxng.svg";
import yahooLogo from "@/assets/yahoo_finance.png";
import tavilyLogo from "@/assets/tavily-color.svg";

// Navbar data-source chips. SeXNG/Yahoo status comes from GET /health/sources —
// a real probe per source, cached server-side for a minute. Tavily is always
// shown (compulsory); connected = the user's Tavily API key is set.
type SourceStatus = { ok?: boolean; href?: string };

type StockRow = {
  ticker?: string;
  SYMBOL?: string;
  name?: string;
  NAME?: string;
  source?: string;
};

export default function NavBar() {
  const { user, signOut } = useAuth();
  const { colorMode, toggleColorMode } = useColorMode();
  const navigate = useNavigate();
  const location = useLocation();
  const email = user?.email ?? "";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sources, setSources] = useState<Record<string, SourceStatus>>({});

  const dataSources = useMemo(
    () => [
      { id: "searxng", name: "SearXNG", img: searxngLogo },
      { id: "tavily", name: "Tavily", img: tavilyLogo },
      { id: "yahoo", name: "Yahoo Finance (yfinance)", img: yahooLogo },
    ],
    [],
  );

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/health/sources`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.sources) setSources(d.sources);
      })
      .catch(() => {});
    // Tavily chip: connected iff the user's API key is set (not a live probe).
    if (user) {
      SettingsService.getSettings()
        .then((d) => {
          if (alive)
            setSources((prev) => ({
              ...prev,
              tavily: { ok: !!d?.llm_keys?.tavily, href: "https://app.tavily.com" },
            }));
        })
        .catch(() => {});
    } else if (alive) {
      setSources((prev) => ({ ...prev, tavily: { ok: false, href: "https://app.tavily.com" } }));
    }
    return () => {
      alive = false;
    };
  }, [user]);

  // Stock search — same logic as the new-analysis company picker:
  // 300ms debounce + AbortController against /stocks/search.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StockRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    const q = query.trim();
    debounceRef.current = setTimeout(async () => {
      if (!q) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch(`${API_BASE}/stocks/search?${new URLSearchParams({ query: q })}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!controller.signal.aborted) setResults(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!(err instanceof DOMException) || err.name !== "AbortError") setResults([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pickStock = (stock: StockRow) => {
    const sym = stock.ticker || stock.SYMBOL || "";
    const src = String(stock.source || "").toUpperCase();
    setSearchOpen(false);
    setQuery("");
    navigate(`/stock/${encodeURIComponent(sym)}?source=${src}`);
  };

  return (
    <nav className="bg-[var(--surface-canvas)]">
      <div className="max-w-[1200px] mx-auto">
        {/* Level 1 — mast */}
        <div className="px-6 flex items-center justify-between pt-6 pb-2">
        <div className="flex items-center gap-5">
          <Link
            to="/"
            className="text-[var(--ink-primary)] select-none cursor-pointer"
            style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 26 }}
          >
            Relativity.
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline text-sm text-[var(--ink-tertiary)] font-light">Data sources</span>
            {/* Generous hit box (pad + negative margin keeps layout put): the fan-out moves chips
                right, so hover must survive the chase. delay-150 on exit = grace before collapse. */}
            <div
              className="group flex items-center -mx-3 px-3 -my-2 py-2 pr-12 -mr-4"
              role="list"
              aria-label="Data sources"
            >
              {dataSources.map((s, i) => {
                const st = sources[s.id];
                const down = st?.ok === false;
                const href = st?.href;
                return (
                  <a
                    key={s.id}
                    href={href}
                    target={href ? "_blank" : undefined}
                    rel={href ? "noreferrer" : undefined}
                    role="listitem"
                    aria-label={`${s.name} — ${st == null ? "checking" : down ? "not connected" : "connected"}`}
                    style={{ "--i": i } as CSSProperties}
                    className={cn(
                      "group/src relative block h-7 w-7 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--ink-primary)_12%,var(--surface-canvas))] p-[5px] shadow-[0_0_0_2px_var(--surface-canvas)] transition-transform duration-300 ease-in-out delay-150 group-hover:delay-0 will-change-transform group-hover:[transform:translateX(calc(var(--i)*12px))] after:absolute after:-inset-1.5 after:rounded-full after:content-['']",
                      i > 0 && "-ml-2",
                      href ? "cursor-pointer" : "cursor-default",
                    )}
                  >
                    <img
                      src={s.img}
                      alt=""
                      aria-hidden="true"
                      className={cn("h-full w-full object-contain", down && "grayscale opacity-40")}
                    />
                    <span className="pointer-events-none invisible absolute left-1/2 top-full z-40 mt-1.5 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-[4px] border border-[var(--hairline)] bg-[var(--surface-canvas)] px-2 py-1 font-[family-name:var(--font-body)] text-xs text-[var(--ink-primary)] opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-all duration-150 group-hover/src:delay-300 group-hover/src:visible group-hover/src:opacity-100">
                      {s.name}
                      {st?.ok === true && <Check size={12} style={{ color: "#7A9E7E" }} />}
                      {down && <TriangleAlert size={12} style={{ color: "#C49A6C" }} />}
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>

        {/* Stock search — centered between the mast and the account controls */}
        <div ref={searchWrapRef} className="relative hidden md:flex flex-1 items-center justify-center">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-tertiary)]" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search stocks…"
              aria-label="Search stocks"
              aria-expanded={searchOpen}
              aria-haspopup="listbox"
              className="h-8 w-52 rounded-[4px] border border-[var(--hairline)] bg-[var(--surface-recessed)] pr-2 pl-8 font-[family-name:var(--font-body)] text-sm font-normal text-[var(--ink-primary)] outline-none focus:border-[var(--ink-tertiary)]"
            />
          </div>
          {searchOpen && query.trim() !== "" && (
            <div
              role="listbox"
              aria-label="Stock results"
              className="listbox-panel absolute top-[calc(100%+6px)] left-1/2 -translate-x-1/2 z-50 max-h-[320px] w-[340px] overflow-y-auto rounded-[6px] border border-[var(--hairline)] bg-[var(--surface-canvas)] py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
            >
              {searching && (
                <div className="px-3 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">Searching…</div>
              )}
              {!searching && results.length === 0 && (
                <div className="px-3 py-2.5 font-[family-name:var(--font-body)] text-xs text-[var(--ink-tertiary)]">
                  Nothing matches “{query}”.
                </div>
              )}
              {!searching &&
                results.map((stock) => {
                  const sym = stock.ticker || stock.SYMBOL || "";
                  const india = String(stock.source || "").toLowerCase() === "nse";
                  const market = india ? "NSE" : "SEC";
                  return (
                    <DropdownItem
                      key={`${market}-${sym}`}
                      label={stock.name || stock.NAME || sym}
                      sub={`${india ? "🇮🇳" : "🇺🇸"} ${market}:${sym}`}
                      logo={<TickerLogo symbol={sym} size={18} />}
                      onClick={() => pickStock(stock)}
                    />
                  );
                })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-5">
          <button
            aria-label="Toggle color mode"
            onClick={toggleColorMode}
            className="text-[var(--ink-tertiary)] hover:opacity-60 transition-opacity cursor-pointer"
          >
            {colorMode === "dark" ? <Moon size={18} /> : <Sun size={18} />}
          </button>

          {/* Avatar — or Log in when signed out */}
          {user ? (
            <Menu.Root positioning={{ placement: "bottom-end" }}>
              <Menu.Trigger asChild>
                <Box cursor="pointer" title={email || "Account"}>
                  <UserAvatar seed={email} size={30} />
                </Box>
              </Menu.Trigger>
              <Menu.Positioner>
                <Menu.Content minWidth="220px">
                  <Flex direction="column" gap={0} px={3} py={2.5} w="full" minW={0}>
                    <Text textStyle="xs" color="fg.muted">Signed in as</Text>
                    <Text fontSize="sm" color="fg" w="full" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                      {email}
                    </Text>
                  </Flex>
                  <Menu.Separator />
                  <Menu.Item value="settings" onClick={() => navigate("/settings")}>
                    <Settings size={15} />
                    <Text fontSize="sm">Settings</Text>
                  </Menu.Item>
                  <Menu.Item value="signout" onClick={() => signOut()}>
                    <LogOut size={15} />
                    <Text fontSize="sm">Sign out</Text>
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Menu.Root>
          ) : (
            <Button size="sm" variant="outline" className="rounded-full px-4 gap-1.5" onClick={() => navigate("/login")}>
              <SquareArrowRightEnter size={15} />
              Log in
            </Button>
          )}

          {/* Mobile hamburger */}
          <button
            aria-label="Menu"
            className="text-[var(--ink-primary)] hover:opacity-60 transition-opacity md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={20} /> : <MenuIcon size={20} />}
          </button>
        </div>
      </div>

      {/* Line between levels */}
      <div className="px-6"><div className="h-px bg-[var(--ink-primary)]" /></div>

      {/* Level 2 — nav links (horizontally scrollable, scrollbar hidden) */}
      <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="px-6 flex items-center justify-between gap-6 h-9 font-[family-name:var(--font-body)] font-light min-w-max">
          <Link
            to="/"
            className={cn(
              "flex items-center gap-2 text-sm transition-colors cursor-pointer shrink-0",
              location.pathname === "/"
                ? "text-[var(--ink-primary)]"
                : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]",
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#C49A6C]" />
            Overview
          </Link>
          <div className="flex items-center gap-6">
            {[
              { to: "/my-workspace", label: "Agents & Skills", end: true, dot: "#7A8B9E" },
              { to: "/new-analysis", label: "New Run", end: false, dot: "#7A9E7E" },
              { to: "/analysis-list", label: "Past Runs", end: false, dot: "#C49A6C" },
            ].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 text-sm transition-colors cursor-pointer shrink-0",
                    isActive
                      ? "text-[var(--ink-primary)]"
                      : "text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]",
                  )
                }
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: item.dot }} />
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>

      {/* Ultra thin light grey line below level 2 */}
      <div className="px-6"><div className="h-px bg-[var(--hairline)]" /></div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[var(--ink-primary)] bg-[var(--surface-canvas)]">
          {[
            { to: "/my-workspace", label: "Agents & Skills" },
            { to: "/new-analysis", label: "New Run" },
            { to: "/analysis-list", label: "Past Runs" },
          ].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setMobileOpen(false)}
              className="block px-6 py-3 text-sm text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] border-b border-[var(--hairline)] transition-colors cursor-pointer"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
      </div>
    </nav>
  );
}
