/**
 * Layout primitives — the Chakra-shaped Box/Flex/Text/etc. implemented as
 * plain styled elements. No runtime styling engine: every prop maps to a
 * real CSS property (style prop), theming stays with the CSS custom
 * properties index.css already defines for light/dark. `as` prop supported
 * (polymorphic), matching Chakra call sites.
 */
import {
    createElement, forwardRef, type CSSProperties, type ElementType, type ReactNode,
} from "react";

type Props = Record<string, unknown> & { as?: ElementType; children?: ReactNode };

/** Chakra spacing token → rem (1 token = 0.25rem). Passthrough otherwise. */
function len(v: unknown): string | number | undefined {
    if (v == null) return undefined;
    if (typeof v === "number") return v * 4 + "px";
    if (typeof v === "string") {
        // Already a CSS value (px, %, var(...), calc(...), rem)
        return v;
    }
    return undefined;
}

function borderColor(v: unknown): string | undefined {
    if (v == null) return undefined;
    if (typeof v === "string" && /^(var\(|#|rgb)/.test(v)) return v;
    return undefined;
}

function px(n: unknown): string | undefined {
    if (typeof n === "number") return `${n}px`;
    if (typeof n === "string") return n;
    return undefined;
}

/** Extract our known style props from the rest; unknown props pass through. */
/**
 * Chakra token values → the app's CSS variables. Handles the token strings
 * call sites actually use ("fg", "fg.muted", "bg.subtle", "border"…).
 */
function token(v: unknown): unknown {
    if (typeof v !== "string") return v;
    switch (v) {
        case "fg": return "var(--ink-primary)";
        case "fg.muted": case "fg.muted": return "var(--ink-tertiary)";
        case "bg": case "bg.subtle": case "bg.muted": return "var(--surface-recessed)";
        case "bg.panel": case "bg.canvas": return v === "bg.canvas" ? "var(--surface-canvas)" : "var(--surface-panel)";
        case "border": return "var(--hairline)";
        case "white": return "#ffffff";
        case "black": return "#000000";
        case "transparent": return "transparent";
        default: return v;
    }
}

/**
 * Chakra responsive values ({ base: x, md: y }) → base style + a min-width
 * media query injected via a <style> tag is heavy; instead, when the window
 * is md+ we apply the md value. A CSS variable hook (useMediaQuery-like via
 * matchMedia, module-level singleton) keeps this cheap.
 */
let mdListenerAttached = false;
let isMd = true;
function ensureMdListener() {
    if (mdListenerAttached || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    mdListenerAttached = true;
    isMd = window.matchMedia("(min-width: 768px)").matches;
    const mq = window.matchMedia("(min-width: 768px)");
    mq.addEventListener("change", (e) => { isMd = e.matches; });
}
function responsive(v: unknown): unknown {
    if (v && typeof v === "object" && !Array.isArray(v)) {
        ensureMdListener();
        const o = v as Record<string, unknown>;
        if (isMd) return o.md ?? o.base;
        return o.base ?? o.md;
    }
    return v;
}

function styleOf(props: Props): CSSProperties {
    const s: CSSProperties = {};
    const p = props as any;
    const one = (v: unknown) => len(responsive(v));

    if (p.paddingX != null) { const v = one(p.paddingX); s.paddingLeft = v; s.paddingRight = v; }
    if (p.paddingY != null) { const v = one(p.paddingY); s.paddingTop = v; s.paddingBottom = v; }
    if (p.p != null) { const v = one(p.p); s.padding = v; }
    if (p.px != null) { const v = one(p.px); s.paddingLeft = v; s.paddingRight = v; }
    if (p.py != null) { const v = one(p.py); s.paddingTop = v; s.paddingBottom = v; }
    if (p.pt != null) s.paddingTop = one(p.pt);
    if (p.pb != null) s.paddingBottom = one(p.pb);
    if (p.pl != null) s.paddingLeft = one(p.pl);
    if (p.pr != null) s.paddingRight = one(p.pr);
    if (p.padding != null) s.padding = one(p.padding);

    if (p.m != null) s.margin = one(p.m);
    if (p.mx != null) { const v = one(p.mx); s.marginLeft = v; s.marginRight = v; }
    if (p.my != null) { const v = one(p.my); s.marginTop = v; s.marginBottom = v; }
    if (p.mt != null) s.marginTop = one(p.mt);
    if (p.mb != null) s.marginBottom = one(p.mb);
    if (p.ml != null) s.marginLeft = one(p.ml);
    if (p.mr != null) s.marginRight = one(p.mr);

    if (p.gap != null) s.gap = one(p.gap);
    if (p.w != null) s.width = one(p.w);
    if (p.minW != null) s.minWidth = one(p.minW);
    if (p.maxW != null) s.maxWidth = one(p.maxW);
    if (p.h != null) s.height = one(p.h);
    if (p.minH != null) s.minHeight = one(p.minH);
    if (p.maxH != null) s.maxHeight = one(p.maxH);
    if (p.boxSize != null) { const v = one(p.boxSize); s.width = v; s.height = v; }

    if (p.bg != null) s.background = token(p.bg) as string;
    if (p.backgroundColor != null) s.background = p.backgroundColor;
    if (p.color != null) s.color = token(p.color) as string;
    if (p.opacity != null) s.opacity = p.opacity;
    if (p.borderRadius != null) s.borderRadius = typeof p.borderRadius === "number" ? `${p.borderRadius}px` : p.borderRadius;
    if (p.border != null) s.border = p.border;
    if (p.borderWidth != null) s.borderWidth = px(p.borderWidth);
    if (p.borderColor != null) { const c = borderColor(token(p.borderColor)); if (c) s.borderColor = c; else if (typeof p.borderColor === "string") s.borderColor = p.borderColor; }
    if (p.borderLeft != null) s.borderLeft = p.borderLeft;
    if (p.borderTop != null) s.borderTop = p.borderTop;
    if (p.overflow != null) s.overflow = p.overflow;
    if (p.overflowX != null) s.overflowX = p.overflowX;
    if (p.overflowY != null) s.overflowY = p.overflowY;
    if (p.display != null) s.display = responsive(p.display) as string;
    if (p.position != null) s.position = p.position;
    if (p.top != null) s.top = one(p.top);
    if (p.bottom != null) s.bottom = one(p.bottom);
    if (p.left != null) s.left = one(p.left);
    if (p.right != null) s.right = one(p.right);
    if (p.inset != null) s.inset = one(p.inset);
    if (p.zIndex != null) s.zIndex = p.zIndex;
    if (p.flex != null) s.flex = p.flex;
    if (p.flexShrink != null) s.flexShrink = p.flexShrink;
    if (p.flexGrow != null) s.flexGrow = p.flexGrow;
    if (p.flexBasis != null) s.flexBasis = p.flexBasis;
    if (p.align != null) s.alignItems = responsive(p.align);
    if (p.alignItems != null) s.alignItems = responsive(p.alignItems);
    if (p.justify != null) s.justifyContent = responsive(p.justify);
    if (p.justifyContent != null) s.justifyContent = responsive(p.justifyContent);
    if (p.direction != null) s.flexDirection = responsive(p.direction);
    if (p.flexDirection != null) s.flexDirection = responsive(p.flexDirection);
    if (p.wrap != null) s.flexWrap = responsive(p.wrap) === "wrap" || responsive(p.wrap) === true ? "wrap" : responsive(p.wrap);
    if (p.flexWrap != null) s.flexWrap = responsive(p.flexWrap);
    if (p.textAlign != null) s.textAlign = p.textAlign;
    if (p.fontSize != null) s.fontSize = typeof p.fontSize === "number" ? `${p.fontSize}px` : p.fontSize;
    if (p.fontWeight != null) s.fontWeight = p.fontWeight;
    if (p.fontFamily != null) s.fontFamily = p.fontFamily;
    if (p.fontStyle != null) s.fontStyle = p.fontStyle;
    if (p.lineHeight != null) s.lineHeight = typeof p.lineHeight === "number" ? `${p.lineHeight * 0.4 + 1}rem` : p.lineHeight;
    if (p.letterSpacing != null) s.letterSpacing = p.letterSpacing;
    if (p.textTransform != null) s.textTransform = p.textTransform;
    if (p.whiteSpace != null) s.whiteSpace = p.whiteSpace;
    if (p.wordBreak != null) s.wordBreak = p.wordBreak;
    if (p.overflowWrap != null) s.overflowWrap = p.overflowWrap;
    if (p.truncate) { s.overflow = "hidden"; s.textOverflow = "ellipsis"; s.whiteSpace = "nowrap"; }
    if (p.lineClamp != null) {
        s.display = "-webkit-box";
        s.WebkitLineClamp = p.lineClamp as unknown as number;
        s.WebkitBoxOrient = "vertical";
        s.overflow = "hidden";
    }
    if (p.textDecoration != null) s.textDecoration = p.textDecoration;
    if (p.cursor != null) s.cursor = p.cursor;
    if (p.pointerEvents != null) s.pointerEvents = p.pointerEvents;
    if (p.userSelect != null) s.userSelect = p.userSelect;
    if (p.boxShadow != null) s.boxShadow = p.boxShadow;
    if (p.filter != null) s.filter = p.filter;
    if (p.transform != null) s.transform = p.transform;
    if (p.transition != null) s.transition = p.transition;
    if (p.animation != null) s.animation = p.animation;
    if (p.resize != null) s.resize = p.resize;
    if (p.visibility != null) s.visibility = p.visibility;
    if (p.scrollMarginTop != null) s.scrollMarginTop = px(p.scrollMarginTop);
    if (p.scrollBehavior != null) s.scrollBehavior = p.scrollBehavior;
    if (p.aspectRatio != null) s.aspectRatio = p.aspectRatio;
    if (p.objectFit != null) s.objectFit = p.objectFit;
    if (p.gridTemplateColumns != null) s.gridTemplateColumns = p.gridTemplateColumns;
    if (p.clip != null) s.clipPath = p.clip === "clip" ? "inset(50%)" : p.clip;
    if (p.srOnly) {
        s.position = "absolute"; s.width = "1px"; s.height = "1px";
        s.padding = "0"; s.margin = "-1px"; s.overflow = "hidden";
        s.clipPath = "inset(50%)"; s.whiteSpace = "nowrap"; s.borderWidth = "0";
    }
    return s;
}

/** Props consumed by the style mapper (never passed to the DOM). */
const STYLE_PROPS = new Set([
    "p", "px", "py", "pt", "pb", "pl", "pr", "padding", "paddingX", "paddingY",
    "m", "mx", "my", "mt", "mb", "ml", "mr",
    "gap", "w", "minW", "maxW", "h", "minH", "maxH", "boxSize",
    "bg", "backgroundColor", "color", "opacity", "borderRadius", "border",
    "borderWidth", "borderColor", "borderLeft", "borderTop",
    "overflow", "overflowX", "overflowY", "display", "position", "top", "bottom",
    "left", "right", "inset", "zIndex", "flex", "flexShrink", "flexGrow", "flexBasis",
    "align", "alignItems", "justify", "justifyContent", "direction", "flexDirection",
    "wrap", "flexWrap", "textAlign", "fontSize", "fontWeight", "fontFamily", "fontStyle",
    "lineHeight", "letterSpacing", "textTransform", "whiteSpace", "wordBreak",
    "overflowWrap", "truncate", "textDecoration", "cursor", "pointerEvents",
    "userSelect", "boxShadow", "filter", "transform", "transition", "animation",
    "resize", "visibility", "scrollMarginTop", "scrollBehavior", "aspectRatio",
    "objectFit", "gridTemplateColumns", "clip", "lineClamp",
    "_hover", "_focus", "_active", "css", "textStyle", "colorPalette", "variant", "size", "as", "srOnly",
]);

function split(props: Props): [CSSProperties, Record<string, unknown>] {
    const style = styleOf(props);
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
        if (STYLE_PROPS.has(k)) continue;
        if (style[k as keyof CSSProperties] !== undefined) continue;
        // Keep handlers, aria, data, standard attrs
        rest[k] = v;
    }
    return [style, rest];
}

function make<Tag extends keyof JSX.IntrinsicElements>(tag: Tag, defaults?: CSSProperties) {
    const C = forwardRef<HTMLElement, Props>(function C(props, ref) {
        const { as, ...restProps } = props;
        const [style, rest] = split(restProps as Props);
        return createElement(as || tag, {
            ref,
            style: { ...defaults, ...style, ...(props as any).style },
            ...rest,
        });
    });
    C.displayName = `Compat.${String(tag)}`;
    return C;
}

export const Box = make("div");
export const Flex = make("div", { display: "flex" });
export const HStack = make("div", { display: "flex", alignItems: "center", gap: 8 });
export const VStack = make("div", { display: "flex", flexDirection: "column", gap: 8 });
export const Stack = HStack;
export const Center = make("div", { display: "flex", alignItems: "center", justifyContent: "center" });
export const Spacer = make("div", { flex: 1 });
export const Grid = make("div", { display: "grid" });
export const Span = make("span");

export const Text = forwardRef<HTMLElement, Props & { as?: ElementType }>(function Text(props, ref) {
    const { as, ...restProps } = props;
    const [style, rest] = split(restProps as Props);
    return createElement(as || "p", { ref, style: { margin: 0, ...style, ...(props as any).style }, ...rest });
});
Text.displayName = "Compat.Text";

export const Heading = forwardRef<HTMLElement, Props & { as?: ElementType }>(function Heading(props, ref) {
    const { as, ...restProps } = props;
    const [style, rest] = split(restProps as Props);
    return createElement(as || "h2", { ref, style: { margin: 0, fontWeight: 600, ...style, ...(props as any).style }, ...rest });
});
Heading.displayName = "Compat.Heading";

export function SimpleGrid(props: Props & { columns?: number | { base?: number; md?: number }; spacing?: unknown }) {
    const { columns, spacing, ...rest } = props;
    const cols = typeof columns === "number" ? columns : (columns?.md ?? columns?.base ?? 2);
    const [style, rest2] = split(rest as Props);
    return createElement("div", {
        style: {
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: len(spacing) ?? "16px",
            ...style,
        } as CSSProperties,
        ...(rest2 as any),
    });
}

export function Container(props: Props & { maxW?: string }) {
    const { maxW, ...rest } = props;
    const [style, rest2] = split(rest as Props);
    return createElement("div", {
        style: {
            maxWidth: maxW ?? "1200px",
            marginInline: "auto",
            width: "100%",
            ...style,
        } as CSSProperties,
        ...(rest2 as any),
    });
}

export const Separator = forwardRef<HTMLDivElement, Props & { orientation?: "horizontal" | "vertical" }>(function Separator(props, ref) {
    const { orientation = "horizontal", ...rest } = props;
    const [style, rest2] = split(rest as Props);
    return createElement("div", {
        ref,
        role: "separator",
        style: {
            background: "var(--hairline)",
            ...(orientation === "vertical" ? { width: "var(--hairline-w)", alignSelf: "stretch", minHeight: "100%" } : { height: "var(--hairline-w)", width: "100%" }),
            ...style,
        } as CSSProperties,
        ...(rest2 as any),
    });
});
Separator.displayName = "Compat.Separator";

/** Divider — legacy alias used by a few pages. */
export const Divider = Separator;

export function Spinner(props: { size?: string; color?: string; borderWidth?: string; [k: string]: unknown }) {
    const { size = "24px", color = "var(--accent-primary)", borderWidth, ...rest } = props;
    const s = typeof size === "string" && /^xs|sm|md|lg$/.test(size)
        ? { xs: 12, sm: 16, md: 24, lg: 32 }[size as "xs" | "sm" | "md" | "lg"] : parseInt(String(size)) || 24;
    return createElement("span", {
        role: "status",
        "aria-label": "Loading",
        style: {
            display: "inline-block",
            width: s, height: s,
            border: `${borderWidth ? parseFloat(String(borderWidth)) * 4 || 2 : 2}px solid transparent`,
            borderTopColor: color,
            borderRightColor: color,
            borderRadius: "50%",
            animation: "compat-spin 0.7s linear infinite",
        },
        ...rest,
    });
}

export const Skeleton = ({ boxSize, ...props }: Props & { boxSize?: unknown }) => {
    const [style, rest] = split({ boxSize, ...props } as Props);
    return createElement("div", {
        style: { background: "var(--surface-recessed)", animation: "compat-pulse 1.4s ease-in-out infinite", borderRadius: 4, ...style } as CSSProperties,
        ...rest,
    });
};

export function Image(props: Props & { src?: string; alt?: string; boxSize?: unknown; objectFit?: string }) {
    const { boxSize, ...rest } = props;
    const [style, rest2] = split({ boxSize, ...rest } as Props);
    return createElement("img", { style: style, ...rest2 });
}

export function Show(props: { when?: unknown; fallback?: ReactNode; children?: ReactNode }) {
    return props.when ? createElement(createElement(">").type as never, {}, props.children) : (props.fallback ?? null);
}

export function For<T>(props: { each: T[] | undefined; children: (item: T, index: number) => ReactNode }) {
    return createElement(">", {}, ...(props.each ?? []).map(props.children));
}

export function ClientOnly(props: { children?: ReactNode; fallback?: ReactNode }) {
    return createElement(">", {}, props.children ?? props.fallback);
}
