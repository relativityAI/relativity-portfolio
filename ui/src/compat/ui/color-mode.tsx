/**
 * Color mode — the Chakra useColorMode/useColorModeValue API over
 * next-themes (which the app already uses; index.html sets the class).
 */
import { ThemeProvider, useTheme } from "next-themes";
import type { ThemeProviderProps } from "next-themes";
import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

export interface ColorModeProviderProps extends ThemeProviderProps {}

export function ColorModeProvider(props: ColorModeProviderProps) {
    return <ThemeProvider attribute="class" disableTransitionOnChange {...props} />;
}

export type ColorMode = "light" | "dark";

export interface UseColorModeReturn {
    colorMode: ColorMode;
    setColorMode: (colorMode: ColorMode) => void;
    toggleColorMode: () => void;
}

export function useColorMode(): UseColorModeReturn {
    const { resolvedTheme, setTheme, forcedTheme } = useTheme();
    const colorMode = (forcedTheme || resolvedTheme || "light") as ColorMode;
    return {
        colorMode,
        setColorMode: setTheme,
        toggleColorMode: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    };
}

export function useColorModeValue<T>(light: T, dark: T): T {
    const { colorMode } = useColorMode();
    return colorMode === "dark" ? dark : light;
}

export function ColorModeIcon() {
    const { colorMode } = useColorMode();
    return colorMode === "dark" ? <Moon size={16} /> : <Sun size={16} />;
}

export function ColorModeButton() {
    const { toggleColorMode } = useColorMode();
    return (
        <button
            type="button"
            onClick={toggleColorMode}
            aria-label="Toggle color mode"
            style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, borderRadius: "var(--radius-box)",
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--ink-secondary)",
            }}
        >
            <ColorModeIcon />
        </button>
    );
}

export function LightMode({ children }: { children?: ReactNode }) {
    return <span style={{ display: "contents" }}>{children}</span>;
}

export function DarkMode({ children }: { children?: ReactNode }) {
    return <span style={{ display: "contents" }}>{children}</span>;
}
