import { useState } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Menu, Flex, Text, Box } from "@chakra-ui/react";
import { Search, Menu as MenuIcon, X, LogOut, Moon, Sun } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { useColorMode } from "@/components/ui/color-mode";
import UserAvatar from "@/components/shared/UserAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const today = new Date().toLocaleDateString("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export default function NavBar() {
  const { user, signOut } = useAuth();
  const { colorMode, toggleColorMode } = useColorMode();
  const navigate = useNavigate();
  const location = useLocation();
  const email = user?.email ?? "";
  const [mobileOpen, setMobileOpen] = useState(false);

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
          <span className="text-sm text-[var(--ink-tertiary)] font-light cursor-pointer">
            Data to {today}
          </span>
        </div>

        <div className="flex items-center gap-5">
          <button
            aria-label="Search"
            className="text-[var(--ink-tertiary)] hover:opacity-60 transition-opacity cursor-pointer"
          >
            <Search size={18} />
          </button>

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
                  <Menu.Item value="signout" onClick={() => signOut()}>
                    <LogOut size={15} />
                    <Text fontSize="sm">Sign out</Text>
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Menu.Root>
          ) : (
            <Button size="sm" variant="outline" className="rounded-full px-4" onClick={() => navigate("/login")}>
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
