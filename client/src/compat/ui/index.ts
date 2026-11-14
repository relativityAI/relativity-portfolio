/**
 * @/compat/ui — the Chakra-shaped API surface, implemented over plain React
 * + Radix (shadcn's base). Rewriting imports from "@/compat/ui" to this
 * module removes the Chakra runtime entirely while call sites keep their
 * exact component/prop shape. Rendering output is ordinary DOM styled with
 * the app's CSS custom properties (index.css light/dark tokens).
 */
export * from "./primitives";
export * from "./components";
export { toaster, Toaster } from "./toaster";
export {
    useColorMode,
    useColorModeValue,
    ColorModeProvider,
    ColorModeButton,
    ColorModeIcon,
    LightMode,
    DarkMode,
    type ColorMode,
} from "./color-mode";
