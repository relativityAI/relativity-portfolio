/**
 * Form & overlay components — the Chakra-shaped API implemented over plain
 * DOM + Radix (via the existing shadcn primitives where behavior matters).
 * Compound namespaces (Dialog.Root / Dialog.Content …) are preserved so
 * call sites keep compiling unchanged.
 */
import {
    Children, cloneElement, createContext, useContext, useEffect, useId,
    useRef, useState, type ReactNode, type CSSProperties, isValidElement,
} from "react";
import * as RDialog from "@radix-ui/react-dialog";
import * as RMenu from "@radix-ui/react-dropdown-menu";
import * as RPopover from "@radix-ui/react-popover";
import * as RSlider from "@radix-ui/react-slider";
import * as RSwitch from "@radix-ui/react-switch";
import { createPortal } from "react-dom";

type AnyProps = Record<string, any>;

/* ── Button ─────────────────────────────────────────────────────────────── */

type Variant = "solid" | "subtle" | "surface" | "outline" | "ghost" | "plain" | "accent" | "secondary" | "line" | "muted";

const BTN_PALETTE: Record<string, string> = {
    blue: "var(--accent-primary)",
    red: "var(--signal-negative)",
    teal: "var(--signal-positive)",
    green: "var(--signal-positive)",
    gray: "var(--ink-secondary)",
    yellow: "var(--signal-caution)",
    orange: "var(--signal-caution)",
};

function btnStyles(variant: Variant = "subtle", colorPalette?: string, disabled?: boolean): CSSProperties {
    const accent = colorPalette ? BTN_PALETTE[colorPalette] || "var(--accent-primary)" : "var(--accent-primary)";
    switch (variant) {
        case "solid":
            return { background: accent, color: "#fff" };
        case "accent":
        case "secondary":
            return { background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)", color: "var(--accent-primary)" };
        case "outline":
        case "line":
            return { background: "transparent", color: "var(--ink-primary)", border: "var(--hairline-w) solid var(--hairline)" };
        case "ghost":
        case "plain":
        case "muted":
            return { background: "transparent", color: "var(--ink-secondary)" };
        case "surface":
            return { background: "var(--surface-recessed)", color: "var(--ink-primary)" };
        default: // subtle
            return { background: "var(--surface-recessed)", color: "var(--ink-primary)" };
    }
}

export const Button = function Button(props: AnyProps) {
    const {
        variant, colorPalette, size = "md", loading, disabled,
        asChild, as, color, bg, ...rest
    } = props;
    const pad = size === "xs" ? { padding: "4px 8px", fontSize: "11px" }
        : size === "sm" ? { padding: "6px 12px", fontSize: "12.5px" }
        : size === "lg" ? { padding: "10px 20px", fontSize: "15px" }
        : { padding: "8px 16px", fontSize: "13.5px" };
    const style: CSSProperties = {
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        borderRadius: "var(--radius-box)",
        // Buttons do not inherit font-family from the page, so without this every
        // button renders in the browser's default UI font.
        fontFamily: "inherit",
        fontWeight: 500,
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled || loading ? 0.55 : 1,
        border: "none",
        transition: "background-color 120ms, opacity 120ms",
        ...(color ? { color } : {}),
        ...(bg ? { background: bg } : {}),
        ...btnStyles(variant, colorPalette, disabled),
        ...(rest.style || {}),
    };
    const Comp: any = as || "button";
    return (
        <Comp
            type={Comp === "button" && !("type" in rest) ? "button" : (rest as any).type}
            disabled={Comp === "button" ? disabled || loading : undefined}
            {...rest}
            style={style}
        >
            {loading && <Spinner size="sm" style={{ width: 14, height: 14 }} />}
            {props.children}
        </Comp>
    );
};

export const IconButton = function IconButton(props: AnyProps) {
    const { variant, colorPalette, size = "md", "aria-label": ariaLabel, ...rest } = props;
    const box = size === "xs" ? 24 : size === "sm" ? 28 : size === "lg" ? 40 : 32;
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            {...rest}
            style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: box, height: box, borderRadius: "var(--radius-box)",
                border: "none", cursor: "pointer",
                ...btnStyles(variant, colorPalette),
                ...(rest.style || {}),
            }}
        />
    );
};

/* ── Inputs ─────────────────────────────────────────────────────────────── */

export const Input = function Input(props: AnyProps) {
    const { size = "md", color, bg, ...rest } = props;
    return (
        <input
            {...rest}
            style={{
                padding: size === "sm" ? "6px 10px" : "8px 12px",
                fontSize: size === "sm" ? "12.5px" : "13.5px",
                background: bg || "var(--surface-panel)",
                color: "var(--ink-primary)",
                border: "var(--hairline-w) solid var(--hairline)",
                borderRadius: "var(--radius-box)",
                outline: "none",
                width: "100%",
                ...(color ? { color } : {}),
                ...(rest.style || {}),
            }}
        />
    );
};

export const Textarea = function Textarea(props: AnyProps) {
    const { ...rest } = props;
    return (
        <textarea
            {...rest}
            style={{
                padding: "8px 12px",
                fontSize: "13.5px",
                background: "var(--surface-panel)",
                color: "var(--ink-primary)",
                border: "var(--hairline-w) solid var(--hairline)",
                borderRadius: "var(--radius-box)",
                outline: "none",
                width: "100%",
                fontFamily: "inherit",
                ...(rest.style || {}),
            }}
        />
    );
};

export function Field(props: { label?: ReactNode; children?: ReactNode; required?: boolean; helperText?: ReactNode; errorText?: ReactNode; [k: string]: unknown }) {
    const { label, children, helperText, errorText } = props;
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {label && <label style={{ fontSize: "12px", fontWeight: 500, color: "var(--ink-secondary)" }}>{label}</label>}
            {children}
            {helperText && <span style={{ fontSize: "11px", color: "var(--ink-tertiary)" }}>{helperText}</span>}
            {errorText && <span style={{ fontSize: "11px", color: "var(--signal-negative)" }}>{errorText}</span>}
        </div>
    );
}
Field.Root = function FieldRoot(props: AnyProps) { return <Field {...props} />; };
Field.Label = function FieldLabel(props: AnyProps) {
    return <label {...props} style={{ fontSize: "12px", fontWeight: 500, color: "var(--ink-secondary)", ...(props.style || {}) }} />;
};
Field.HelperText = function FieldHelper(props: AnyProps) {
    return <span {...props} style={{ fontSize: "11px", color: "var(--ink-tertiary)", ...(props.style || {}) }} />;
};
Field.ErrorText = function FieldError(props: AnyProps) {
    return <span {...props} style={{ fontSize: "11px", color: "var(--signal-negative)", ...(props.style || {}) }} />;
};

/* ── Badge / Tag ────────────────────────────────────────────────────────── */

export function Badge(props: AnyProps) {
    const { variant = "subtle", colorPalette, ...rest } = props;
    const accent = colorPalette ? BTN_PALETTE[colorPalette] || "var(--accent-primary)" : "var(--ink-secondary)";
    const style: CSSProperties = {
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 999, fontSize: "11px", fontWeight: 500,
        ...(variant === "solid"
            ? { background: accent, color: "#fff" }
            : { background: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }),
        ...(rest.style || {}),
    };
    return <span {...rest} style={style} />;
}

export function Tag(props: AnyProps) {
    return <Badge {...props} />;
}
Tag.Root = Tag;
Tag.Label = function TagLabel(props: AnyProps) { return <span {...props} />; };
Tag.CloseTrigger = function TagClose(props: AnyProps) {
    return <button type="button" aria-label="Remove" {...props} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, ...(props.style || {}) }}>×</button>;
};

/* ── Switch ─────────────────────────────────────────────────────────────── */

const SwitchRoot = function SwitchRoot(props: AnyProps) {
    const { checked, defaultChecked, onCheckedChange, disabled, ...rest } = props;
    const [on, setOn] = useState(defaultChecked ?? false);
    const isOn = checked ?? on;
    return (
        <button
            type="button"
            role="switch"
            aria-checked={isOn}
            disabled={disabled}
            onClick={() => { const n = !isOn; setOn(n); onCheckedChange?.(n); }}
            {...rest}
            style={{
                width: 36, height: 20, borderRadius: 999,
                background: isOn ? "var(--accent-primary)" : "var(--hairline)",
                position: "relative", cursor: "pointer", border: "none", padding: 0,
                transition: "background-color 150ms",
                ...(rest.style || {}),
            }}
        >
            <span style={{
                position: "absolute", top: 2, left: isOn ? 18 : 2,
                width: 16, height: 16, borderRadius: "50%", background: "#fff",
                transition: "left 150ms", boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }} />
        </button>
    );
};
SwitchRoot.Control = function SwitchControl(props: AnyProps) { return <span {...props} />; };
SwitchRoot.Thumb = function SwitchThumb(props: AnyProps) { return <span {...props} />; };
SwitchRoot.HiddenInput = function SwitchHidden() { return null; };
export const Switch = SwitchRoot;
Switch.Root = SwitchRoot;

/* ── Checkbox ───────────────────────────────────────────────────────────── */

export const Checkbox = function Checkbox(props: AnyProps) {
    const { checked, defaultChecked, onCheckedChange, disabled, children, ...rest } = props;
    const [on, setOn] = useState(defaultChecked ?? false);
    const isOn = checked ?? on;
    return (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
                type="checkbox"
                checked={isOn}
                disabled={disabled}
                onChange={(e) => { setOn(e.target.checked); onCheckedChange?.(e.target.checked); }}
                {...rest}
                style={{ width: 15, height: 15, accentColor: "var(--accent-primary)", cursor: "pointer" }}
            />
            {children}
        </label>
    );
};
Checkbox.Root = function CheckboxRoot(props: AnyProps) {
    const { checked, onCheckedChange, children, ...rest } = props;
    return (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
                type="checkbox"
                checked={!!checked}
                onChange={(e) => onCheckedChange?.(e.target.checked)}
                {...rest}
                style={{ width: 15, height: 15, accentColor: "var(--accent-primary)" }}
            />
            {children}
        </label>
    );
};
Checkbox.Control = function CheckboxControl(props: AnyProps) { return <span {...props} />; };
Checkbox.Label = function CheckboxLabel(props: AnyProps) { return <span {...props} />; };
Checkbox.HiddenInput = function CheckboxHidden() { return null; };
Checkbox.Indicator = function CheckboxIndicator(props: AnyProps) { return <span {...props} />; };

/* ── Slider ─────────────────────────────────────────────────────────────── */

const SliderRoot = function SliderRoot(props: AnyProps) {
    const { value, defaultValue = [0], min = 0, max = 100, step = 1, onValueChange, onValueChangeEnd, children, ...rest } = props;
    const [inner, setInner] = useState(Array.isArray(defaultValue) ? defaultValue : [defaultValue]);
    const current = value ?? inner;
    return (
        <div {...rest}>
            <input
                type="range"
                min={min} max={max} step={step}
                value={current[0]}
                onChange={(e) => { const v = [Number(e.target.value)]; setInner(v); onValueChange?.(v); }}
                onMouseUp={(e) => onValueChangeEnd?.([Number((e.target as HTMLInputElement).value)])}
                onTouchEnd={(e) => onValueChangeEnd?.([Number((e.target as HTMLInputElement).value)])}
                style={{ width: "100%", accentColor: "var(--accent-primary)", cursor: "pointer" }}
            />
            {children}
        </div>
    );
};
SliderRoot.Control = function SliderControl(props: AnyProps) { return <div {...props} />; };
SliderRoot.Track = function SliderTrack(props: AnyProps) { return <div {...props} />; };
SliderRoot.Range = function SliderRange(props: AnyProps) { return <div {...props} />; };
SliderRoot.Thumb = function SliderThumb(props: AnyProps) { return <div {...props} />; };
SliderRoot.ValueText = function SliderValueText(props: AnyProps) { return <span {...props} />; };
SliderRoot.HiddenInput = function SliderHidden() { return null; };
export const Slider = SliderRoot;
Slider.Root = SliderRoot;

/* ── Radio ──────────────────────────────────────────────────────────────── */

export function RadioGroup(props: AnyProps) {
    const { value, onValueChange, children, ...rest } = props;
    return (
        <div role="radiogroup" {...rest} onChange={() => {}}>
            {Children.map(children, (child) =>
                isValidElement(child) ? cloneElement(child as any, { __groupValue: value, __onValueChange: onValueChange }) : child)}
        </div>
    );
}
RadioGroup.Root = RadioGroup;
RadioGroup.Item = function RadioItem(props: AnyProps) {
    const { value, children, __groupValue, __onValueChange, ...rest } = props;
    const checked = __groupValue === value;
    return (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="radio" checked={checked} onChange={() => __onValueChange?.(value)} style={{ accentColor: "var(--accent-primary)" }} />
            {children}
        </label>
    );
};
RadioGroup.ItemText = function RadioItemText(props: AnyProps) { return <span {...props} />; };
RadioGroup.ItemIndicator = function RadioItemIndicator(props: AnyProps) { return <span {...props} />; };
RadioGroup.ItemHiddenInput = function RadioItemHidden() { return null; };

/* ── Table (compound, line variant) ─────────────────────────────────────── */

const TableCtx = createContext<{ line: boolean }>({ line: true });

const TableRoot = function TableRoot(props: AnyProps) {
    const { variant = "line", size, interactive, ...rest } = props;
    return (
        <TableCtx.Provider value={{ line: variant === "line" }}>
            <div style={{ overflowX: "auto", width: "100%" }}>
                <table {...rest} style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px", ...(rest.style || {}) }} />
            </div>
        </TableCtx.Provider>
    );
};
TableRoot.Header = function TableHeader(props: AnyProps) { return <thead {...props} />; };
TableRoot.Body = function TableBody(props: AnyProps) { return <tbody {...props} />; };
TableRoot.Footer = function TableFooter(props: AnyProps) { return <tfoot {...props} />; };
TableRoot.Row = function TableRow(props: AnyProps) {
    return <tr {...props} style={{ borderBottom: "var(--hairline-w) solid var(--hairline)", ...(props.style || {}) }} />;
};
TableRoot.ColumnHeader = function TableColHeader(props: AnyProps) {
    return <th {...props} style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600, color: "var(--ink-secondary)", borderBottom: "var(--hairline-w) solid var(--grid-line)", whiteSpace: "nowrap", ...(props.style || {}) }} />;
};
TableRoot.Cell = function TableCell(props: AnyProps) {
    return <td {...props} style={{ padding: "8px 12px", verticalAlign: "top", ...(props.style || {}) }} />;
};
TableRoot.Column = function TableColumn(props: AnyProps) { return <col {...props} />; };
TableRoot.ColumnGroup = function TableColumnGroup(props: AnyProps) { return <colgroup {...props} />; };
TableRoot.Caption = function TableCaption(props: AnyProps) { return <caption {...props} />; };
export const Table = TableRoot;
Table.Root = TableRoot;

/* ── Dialog (compound over Radix) ───────────────────────────────────────── */

const DialogRoot = function DialogRoot(props: AnyProps) {
    const { open, onOpenChange, defaultOpen, children, ...rest } = props;
    return (
        <RDialog.Root open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
            {children}
        </RDialog.Root>
    );
};
DialogRoot.Root = DialogRoot;
DialogRoot.Trigger = function DialogTrigger(props: AnyProps) {
    const { asChild, ...rest } = props;
    return <RDialog.Trigger asChild={asChild} {...rest} />;
};
DialogRoot.CloseTrigger = function DialogCloseTrigger(props: AnyProps) {
    const { asChild, ...rest } = props;
    return <RDialog.Close asChild={asChild} {...rest} />;
};
DialogRoot.Backdrop = function DialogBackdrop(props: AnyProps) {
    return <RDialog.Overlay style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50, ...(props.style || {}) }} />;
};
DialogRoot.Positioner = function DialogPositioner(props: AnyProps) {
    return (
        <RDialog.Portal>
            <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 51, padding: 16, pointerEvents: "none" }}>
                <div style={{ pointerEvents: "auto" }}>{props.children}</div>
            </div>
        </RDialog.Portal>
    );
};
DialogRoot.Content = function DialogContent(props: AnyProps) {
    return (
        <RDialog.Content
            {...props}
            style={{
                background: "var(--surface-floating, var(--surface-panel))",
                color: "var(--ink-primary)",
                border: "var(--hairline-w) solid var(--hairline)",
                borderRadius: "var(--radius-surface)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.14)",
                maxWidth: "560px", width: "100%",
                maxHeight: "85vh", overflowY: "auto",
                padding: 20,
                ...(props.style || {}),
            }}
        />
    );
};
DialogRoot.Header = function DialogHeader(props: AnyProps) { return <div {...props} style={{ marginBottom: 12, ...(props.style || {}) }} />; };
DialogRoot.Title = function DialogTitle(props: AnyProps) {
    return <RDialog.Title {...props} style={{ fontSize: "16px", fontWeight: 600, margin: 0, ...(props.style || {}) }} />;
};
DialogRoot.Description = function DialogDescription(props: AnyProps) {
    return <RDialog.Description {...props} style={{ fontSize: "12.5px", color: "var(--ink-secondary)", marginTop: 4, ...(props.style || {}) }} />;
};
DialogRoot.Body = function DialogBody(props: AnyProps) { return <div {...props} style={{ display: "flex", flexDirection: "column", gap: 12, ...(props.style || {}) }} />; };
DialogRoot.Footer = function DialogFooter(props: AnyProps) { return <div {...props} style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }} />; };
export const Dialog = DialogRoot;

/* ── Drawer (compound over Radix Dialog; slides from a side) ────────────── */

const DrawerRoot = function DrawerRoot(props: AnyProps) {
    const { open, onOpenChange, children, ...rest } = props;
    return <RDialog.Root open={open} onOpenChange={onOpenChange}>{children}</RDialog.Root>;
};
DrawerRoot.Trigger = function DrawerTrigger(props: AnyProps) { return <RDialog.Trigger asChild {...props} />; };
DrawerRoot.CloseTrigger = function DrawerCloseTrigger(props: AnyProps) { return <RDialog.Close asChild {...props} />; };
DrawerRoot.Backdrop = function DrawerBackdrop() {
    return <RDialog.Overlay style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 50 }} />;
};
DrawerRoot.Positioner = function DrawerPositioner(props: AnyProps) {
    return <RDialog.Portal><div style={{ position: "fixed", inset: 0, zIndex: 51, pointerEvents: "none" }}>{props.children}</div></RDialog.Portal>;
};
DrawerRoot.Content = function DrawerContent(props: AnyProps) {
    return (
        <RDialog.Content
            {...props}
            style={{
                position: "fixed", top: 0, bottom: 0, left: 0,
                width: "min(320px, 85vw)", height: "100%",
                background: "var(--surface-panel)", color: "var(--ink-primary)",
                borderRight: "var(--hairline-w) solid var(--hairline)",
                boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
                pointerEvents: "auto", display: "flex", flexDirection: "column",
                ...(props.style || {}),
            }}
        />
    );
};
DrawerRoot.Header = function DrawerHeader(props: AnyProps) { return <div {...props} />; };
DrawerRoot.Body = function DrawerBody(props: AnyProps) { return <div {...props} style={{ flex: 1, overflowY: "auto", ...(props.style || {}) }} />; };
DrawerRoot.Footer = function DrawerFooter(props: AnyProps) { return <div {...props} />; };
export const Drawer = DrawerRoot;
Drawer.Root = DrawerRoot;

/* ── Combobox — minimal shim: renders its Input; list handled by call sites
   that used it (SearchBar was rewritten). Kept so any stray import still
   resolves at build time. ── */

const ComboboxRoot = function ComboboxRoot(props: AnyProps) {
    return <div {...props} />;
};
ComboboxRoot.Root = ComboboxRoot;
ComboboxRoot.Label = function ComboboxLabel(props: AnyProps) { return <label {...props} />; };
ComboboxRoot.Control = function ComboboxControl(props: AnyProps) { return <div {...props} />; };
ComboboxRoot.Input = function ComboboxInput(props: AnyProps) { return <input {...props} />; };
ComboboxRoot.Trigger = function ComboboxTrigger() { return null; };
ComboboxRoot.ClearTrigger = function ComboboxClearTrigger() { return null; };
ComboboxRoot.IndicatorGroup = function ComboboxIndicatorGroup(props: AnyProps) { return <span {...props} />; };
ComboboxRoot.Positioner = function ComboboxPositioner(props: AnyProps) { return <div {...props} />; };
ComboboxRoot.Content = function ComboboxContent(props: AnyProps) { return <div {...props} />; };
ComboboxRoot.Item = function ComboboxItem(props: AnyProps) { return <div {...props} />; };
ComboboxRoot.ItemIndicator = function ComboboxItemIndicator() { return null; };
export const Combobox = ComboboxRoot;

/** Chakra's createListCollection — a pass-through for call sites that still
 * build collections; `.items` is the only member anything reads. */
export function createListCollection<T extends { items?: unknown[] }>(opts: T): T & { items: unknown[] } {
    return { items: [], ...opts } as T & { items: unknown[] };
}

/* ── Menu (compound over Radix dropdown-menu) ───────────────────────────── */

const MenuRoot = function MenuRoot(props: AnyProps) {
    const { children, ...rest } = props;
    return <RMenu.Root {...rest}>{children}</RMenu.Root>;
};
MenuRoot.Trigger = function MenuTrigger(props: AnyProps) {
    return <RMenu.Trigger asChild {...props} />;
};
MenuRoot.Positioner = function MenuPositioner(props: AnyProps) {
    const { children, ...rest } = props;
    return <RMenu.Portal><RMenu.Content sideOffset={6} {...rest}>{children}</RMenu.Content></RMenu.Portal>;
};
MenuRoot.Content = function MenuContent(props: AnyProps) { return <div {...props} />; };
MenuRoot.Item = function MenuItem(props: AnyProps) {
    const { value, ...rest } = props;
    return (
        <RMenu.Item
            {...rest}
            style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 10px", fontSize: "12.5px", borderRadius: 4,
                cursor: "pointer", color: props.color || "var(--ink-primary)",
                outline: "none",
                ...(rest.style || {}),
            }}
        />
    );
};
MenuRoot.ItemGroup = function MenuItemGroup(props: AnyProps) { return <div {...props} />; };
MenuRoot.ItemGroupLabel = function MenuItemGroupLabel(props: AnyProps) {
    return <div {...props} style={{ fontSize: "10.5px", fontWeight: 600, color: "var(--ink-tertiary)", padding: "6px 10px 2px", ...(props.style || {}) }} />;
};
MenuRoot.Separator = function MenuSeparator() {
    return <RMenu.Separator style={{ height: "var(--hairline-w)", background: "var(--hairline)", margin: "4px 0" }} />;
};
export const Menu = MenuRoot;
Menu.Root = MenuRoot;

/* ── Popover (compound over Radix) ──────────────────────────────────────── */

const PopoverRoot = function PopoverRoot(props: AnyProps) {
    const { open, onOpenChange, children, ...rest } = props;
    return <RPopover.Root open={open} onOpenChange={onOpenChange}>{children}</RPopover.Root>;
};
PopoverRoot.Trigger = function PopoverTrigger(props: AnyProps) { return <RPopover.Trigger asChild {...props} />; };
PopoverRoot.Positioner = function PopoverPositioner(props: AnyProps) {
    const { children, ...rest } = props;
    return <RPopover.Portal><RPopover.Content sideOffset={6} {...rest}>{children}</RPopover.Content></RPopover.Portal>;
};
PopoverRoot.Content = function PopoverContent(props: AnyProps) { return <div {...props} />; };
PopoverRoot.Header = function PopoverHeader(props: AnyProps) { return <div {...props} style={{ fontWeight: 600, fontSize: "13px", marginBottom: 8 }} />; };
PopoverRoot.Body = function PopoverBody(props: AnyProps) { return <div {...props} />; };
PopoverRoot.CloseTrigger = function PopoverCloseTrigger(props: AnyProps) { return <RPopover.Close asChild {...props} />; };
PopoverRoot.Arrow = function PopoverArrow(props: AnyProps) { return <RPopover.Arrow {...props} />; };
PopoverRoot.ArrowTip = function PopoverArrowTip(props: AnyProps) { return <RPopover.ArrowTip {...props} />; };
PopoverRoot.Anchor = function PopoverAnchor(props: AnyProps) { return <RPopover.Anchor asChild {...props} />; };
export const Popover = PopoverRoot;
Popover.Root = PopoverRoot;

/* ── Accordion (compound, self-contained) ───────────────────────────────── */

const AccordionCtx = createContext<{ openSet: Set<string>; toggle: (v: string) => void; multiple: boolean } | null>(null);

const AccordionRoot = function AccordionRoot(props: AnyProps) {
    const { defaultValue, value, multiple = false, children, ...rest } = props;
    const [openSet, setOpenSet] = useState<Set<string>>(new Set(Array.isArray(defaultValue) ? defaultValue : defaultValue ? [defaultValue] : []));
    const toggle = (v: string) => setOpenSet((prev) => {
        const next = new Set(multiple ? prev : []);
        if (!prev.has(v) || multiple) next.has(v) ? next.delete(v) : next.add(v);
        return next;
    });
    return (
        <AccordionCtx.Provider value={{ openSet: value !== undefined ? new Set(Array.isArray(value) ? value : [value]) : openSet, toggle, multiple }}>
            <div {...rest}>{children}</div>
        </AccordionCtx.Provider>
    );
};
AccordionRoot.Item = function AccordionItem(props: AnyProps & { value?: string }) {
    const { value, children, ...rest } = props;
    const v = value ?? "item";
    return (
        <AccordionItemCtx.Provider value={v}>
            <div {...rest}>{children}</div>
        </AccordionItemCtx.Provider>
    );
};
const AccordionItemCtx = createContext<string>("item");
AccordionRoot.ItemTrigger = function AccordionItemTrigger(props: AnyProps) {
    const v = useContext(AccordionItemCtx);
    const acc = useContext(AccordionCtx);
    return (
        <button type="button" onClick={() => acc?.toggle(v)} aria-expanded={acc?.openSet.has(v)} {...props} style={{ cursor: "pointer", textAlign: "left", width: "100%", ...(props.style || {}) }} />
    );
};
AccordionRoot.ItemContent = function AccordionItemContent(props: AnyProps) {
    const v = useContext(AccordionItemCtx);
    const acc = useContext(AccordionCtx);
    if (!acc?.openSet.has(v)) return null;
    return <div {...props} />;
};
AccordionRoot.ItemBody = function AccordionItemBody(props: AnyProps) {
    const v = useContext(AccordionItemCtx);
    const acc = useContext(AccordionCtx);
    if (!acc?.openSet.has(v)) return null;
    return <div {...props} />;
};
AccordionRoot.ItemIndicator = function AccordionItemIndicator(props: AnyProps) {
    const v = useContext(AccordionItemCtx);
    const acc = useContext(AccordionCtx);
    return <span {...props} style={{ display: "inline-block", transition: "transform 150ms", transform: acc?.openSet.has(v) ? "rotate(180deg)" : "none", ...(props.style || {}) }} />;
};
export const Accordion = AccordionRoot;
Accordion.Root = AccordionRoot;

/* ── Tabs (compound, self-contained) ────────────────────────────────────── */

const TabsCtx = createContext<{ value: string; setValue: (v: string) => void } | null>(null);

const TabsRoot = function TabsRoot(props: AnyProps) {
    const { defaultValue, value, onValueChange, children, ...rest } = props;
    const [inner, setInner] = useState(defaultValue ?? "");
    const current = value ?? inner;
    const setValue = (v: string) => { setInner(v); onValueChange?.(v); };
    return (
        <TabsCtx.Provider value={{ value: current, setValue }}>
            <div {...rest}>{children}</div>
        </TabsCtx.Provider>
    );
};
TabsRoot.List = function TabsList(props: AnyProps) { return <div role="tablist" {...props} />; };
TabsRoot.Trigger = function TabsTrigger(props: AnyProps) {
    const { value, ...rest } = props;
    const ctx = useContext(TabsCtx);
    return (
        <button
            type="button"
            role="tab"
            aria-selected={ctx?.value === value}
            onClick={() => ctx?.setValue(value)}
            {...rest}
            style={{
                padding: "8px 12px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
                border: "none", background: "transparent",
                color: ctx?.value === value ? "var(--ink-primary)" : "var(--ink-tertiary)",
                borderBottom: ctx?.value === value ? "2px solid var(--accent-primary)" : "2px solid transparent",
                ...(rest.style || {}),
            }}
        />
    );
};
TabsRoot.Content = function TabsContent(props: AnyProps) {
    const { value, ...rest } = props;
    const ctx = useContext(TabsCtx);
    if (ctx?.value !== value) return null;
    return <div role="tabpanel" {...rest} />;
};
TabsRoot.Indicator = function TabsIndicator() { return null; };
export const Tabs = TabsRoot;
Tabs.Root = TabsRoot;

/* ── Select (Chakra v3 compound; native select under the hood) ──────────── */

const SelectCtx = createContext<{ value: string; setValue: (v: string) => void; items: Map<string, { label: ReactNode }> } | null>(null);

const SelectRoot = function SelectRoot(props: AnyProps) {
    const { value, defaultValue, onValueChange, children, ...rest } = props;
    const [inner, setInner] = useState(defaultValue ?? "");
    const itemsRef = useRef(new Map<string, { label: ReactNode }>());
    const current = value ?? inner;
    const setValue = (v: string) => { setInner(v); onValueChange?.({ value: v }); };
    // Collection pass: register items so the hidden native select renders.
    const flat: ReactNode[] = [];
    const collect = (node: ReactNode) => Children.forEach(node, (child) => {
        if (!isValidElement(child)) return;
        const c: any = child;
        if (c.type === SelectItem) {
            const val = String(c.props.value);
            itemsRef.current.set(val, { label: findItemText(c.props.children) });
            flat.push(child);
        } else if (c.props?.children) {
            flat.push(cloneElement(c, { children: collect(c.props.children) }));
        } else {
            flat.push(child);
        }
    });
    const collected = collect(children);
    return (
        <SelectCtx.Provider value={{ value: current, setValue, items: itemsRef.current }}>
            <div data-compat-select style={{ position: "relative", display: "inline-flex", width: "100%", ...rest.style }}>
                <select
                    aria-label={rest["aria-label"]}
                    value={current}
                    onChange={(e) => setValue(e.target.value)}
                    style={{
                        appearance: "none",
                        padding: "8px 28px 8px 12px",
                        fontSize: "13px",
                        background: "var(--surface-panel)",
                        color: current ? "var(--ink-primary)" : "var(--ink-tertiary)",
                        border: "var(--hairline-w) solid var(--hairline)",
                        borderRadius: "var(--radius-box)",
                        outline: "none",
                        width: "100%",
                        cursor: "pointer",
                    }}
                >
                    <option value="" disabled hidden />
                    {Array.from(itemsRef.current.entries()).map(([v, it]) => (
                        <option key={v} value={v}>{it.label as any}</option>
                    ))}
                </select>
                <span aria-hidden style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--ink-tertiary)", fontSize: 10 }}>
                    ▾
                </span>
                {/* The app's JSX tree (Select.Control/Trigger/Content…) renders
                    invisibly so the structure stays, but the native select is the
                    real control. Positioner/Content render their children only
                    through the open state, which we keep "closed" for chrome. */}
                <div style={{ display: "none" }}>{collected}</div>
            </div>
        </SelectCtx.Provider>
    );
};

function findItemText(children: ReactNode): ReactNode {
    let text: ReactNode = null;
    Children.forEach(children, (child) => {
        if (text || !isValidElement(child)) return;
        const c: any = child;
        if (c.type === SelectItemText) text = c.props.children;
        else if (c.props?.children) text = findItemText(c.props.children) || text;
    });
    return text ?? "";
}

SelectRoot.Root = SelectRoot;
SelectRoot.Control = function SelectControl(props: AnyProps) { return <div {...props} style={{ display: "contents" }} />; };
SelectRoot.Trigger = function SelectTrigger(props: AnyProps) { return <div {...props} style={{ display: "contents" }} />; };
SelectRoot.ValueText = function SelectValueText(props: AnyProps) { return <span {...props} />; };
SelectRoot.IndicatorGroup = function SelectIndicatorGroup(props: AnyProps) { return <span {...props} style={{ display: "contents" }} />; };
SelectRoot.Indicator = function SelectIndicator(props: AnyProps) { return <span {...props} />; };
SelectRoot.HiddenSelect = function SelectHidden() { return null; };
SelectRoot.Positioner = function SelectPositioner(props: AnyProps) { return <div {...props} style={{ display: "none" }} />; };
SelectRoot.Content = function SelectContent(props: AnyProps) { return <div {...props} style={{ display: "contents" }} />; };
const SelectItemText = function SelectItemText(props: AnyProps) { return <span {...props} />; };
const SelectItemIndicator = function SelectItemIndicator(props: AnyProps) { return <span {...props} style={{ display: "none" }} />; };
const SelectItem = function SelectItem(props: AnyProps) { return <div {...props} style={{ display: "none" }} />; };
SelectItem.Item = SelectItem;
SelectItem.ItemText = SelectItemText;
SelectItem.ItemIndicator = SelectItemIndicator;
SelectRoot.Item = SelectItem;
SelectRoot.ItemText = SelectItemText;
SelectRoot.ItemIndicator = SelectItemIndicator;
export { SelectItem, SelectItemText, SelectItemIndicator };
export const Select = SelectRoot;

/* ── Avatar (compound, self-contained) ──────────────────────────────────── */

const AvatarRoot = function AvatarRoot(props: AnyProps) {
    const { size = "32px", children, ...rest } = props;
    const box = typeof size === "number" ? `${size}px` : { xs: 20, sm: 24, md: 32, lg: 40, xl: 48 }[size as string] || size;
    return (
        <span
            {...rest}
            style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: box, height: box, borderRadius: "50%", overflow: "hidden",
                background: "var(--surface-recessed)", flexShrink: 0,
                ...(rest.style || {}),
            }}
        >
            {children}
        </span>
    );
};
AvatarRoot.Image = function AvatarImage(props: AnyProps) { return <img {...props} style={{ width: "100%", height: "100%", objectFit: "cover", ...(props.style || {}) }} />; };
AvatarRoot.Fallback = function AvatarFallback(props: AnyProps) { return <span {...props} style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-secondary)", ...(props.style || {}) }} />; };
export const Avatar = AvatarRoot;
Avatar.Root = AvatarRoot;

/* ── Alert (compound) ───────────────────────────────────────────────────── */

const ALERT_TONE: Record<string, { bg: string; border: string; icon: string }> = {
    info: { bg: "color-mix(in srgb, var(--accent-primary) 8%, transparent)", border: "var(--accent-primary)", icon: "var(--accent-primary)" },
    warning: { bg: "color-mix(in srgb, var(--signal-caution) 8%, transparent)", border: "var(--signal-caution)", icon: "var(--signal-caution)" },
    success: { bg: "color-mix(in srgb, var(--signal-positive) 8%, transparent)", border: "var(--signal-positive)", icon: "var(--signal-positive)" },
    error: { bg: "color-mix(in srgb, var(--signal-negative) 8%, transparent)", border: "var(--signal-negative)", icon: "var(--signal-negative)" },
};

const AlertRoot = function AlertRoot(props: AnyProps) {
    const { tone = "info", variant = "subtle", children, ...rest } = props;
    const t = ALERT_TONE[tone] || ALERT_TONE.info;
    return (
        <AlertToneCtx.Provider value={t}>
            <div
                role="alert"
                {...rest}
                style={{
                    display: "flex", gap: 10, padding: "10px 12px",
                    borderRadius: "var(--radius-box)",
                    background: t.bg,
                    border: variant === "outline" ? `var(--hairline-w) solid ${t.border}` : "none",
                    ...(rest.style || {}),
                }}
            >
                {children}
            </div>
        </AlertToneCtx.Provider>
    );
};
const AlertToneCtx = createContext(ALERT_TONE.info);
AlertRoot.Root = AlertRoot;
AlertRoot.Indicator = function AlertIndicator(props: AnyProps) {
    const t = useContext(AlertToneCtx);
    return <span {...props} style={{ color: t.icon, flexShrink: 0, marginTop: 1, display: "inline-flex", ...(props.style || {}) }} />;
};
AlertRoot.Content = function AlertContent(props: AnyProps) { return <div {...props} style={{ minWidth: 0, flex: 1 }} />; };
AlertRoot.Title = function AlertTitle(props: AnyProps) { return <div {...props} style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink-primary)", ...(props.style || {}) }} />; };
AlertRoot.Description = function AlertDescription(props: AnyProps) { return <div {...props} style={{ fontSize: "12.5px", color: "var(--ink-secondary)", marginTop: 2, ...(props.style || {}) }} />; };
export const Alert = AlertRoot;

/* ── Stat (compound) ────────────────────────────────────────────────────── */

const StatRoot = function StatRoot(props: AnyProps) { return <div {...props} />; };
StatRoot.Root = StatRoot;
StatRoot.Label = function StatLabel(props: AnyProps) { return <div {...props} style={{ fontSize: "11px", fontWeight: 500, color: "var(--ink-tertiary)", ...(props.style || {}) }} />; };
StatRoot.ValueText = function StatValueText(props: AnyProps) { return <div {...props} style={{ fontSize: "22px", fontWeight: 700, color: "var(--ink-primary)", fontFamily: "var(--font-tabular)", ...(props.style || {}) }} />; };
StatRoot.HelperText = function StatHelperText(props: AnyProps) { return <div {...props} style={{ fontSize: "11px", color: "var(--ink-tertiary)", ...(props.style || {}) }} />; };
export const Stat = StatRoot;

/* ── Progress (compound) ────────────────────────────────────────────────── */

const ProgressRoot = function ProgressRoot(props: AnyProps) {
    const { value = 0, max = 100, colorPalette, children, ...rest } = props;
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    return (
        <div {...rest}>
            <div style={{ height: 6, background: "var(--surface-recessed)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: colorPalette ? BTN_PALETTE[colorPalette] || "var(--accent-primary)" : "var(--accent-primary)", transition: "width 200ms" }} />
            </div>
            {children}
        </div>
    );
};
ProgressRoot.Track = function ProgressTrack(props: AnyProps) { return <div {...props} />; };
ProgressRoot.Range = function ProgressRange(props: AnyProps) { return <div {...props} />; };
ProgressRoot.Label = function ProgressLabel(props: AnyProps) { return <div {...props} />; };
ProgressRoot.ValueText = function ProgressValueText(props: AnyProps) { return <div {...props} />; };
export const Progress = ProgressRoot;

/* ── Tooltip (compound over Radix) ──────────────────────────────────────── */

const TooltipRoot = function TooltipRoot(props: AnyProps) {
    const { content, children, showArrow, positioning, openDelay = 200, closeDelay = 100, ...rest } = props;
    return (
        <RPopover.Root openDelay={openDelay} closeDelay={closeDelay}>
            <RPopover.Trigger asChild>{children}</RPopover.Trigger>
            <RPopover.Portal>
                <RPopover.Content sideOffset={6} {...rest} style={{ background: "var(--surface-inverse)", color: "var(--ink-inverse-primary)", fontSize: "11.5px", padding: "5px 8px", borderRadius: 4, maxWidth: 260, zIndex: 60 }}>
                    {content}
                </RPopover.Content>
            </RPopover.Portal>
        </RPopover.Root>
    );
};
export const Tooltip = TooltipRoot;

/* ── Code / Kbd / List ──────────────────────────────────────────────────── */

export const Code = function Code(props: AnyProps) {
    return <code {...props} style={{ fontFamily: "var(--font-mono)", fontSize: "0.92em", background: "var(--surface-recessed)", padding: "1px 5px", borderRadius: 3, ...(props.style || {}) }} />;
};

export const Kbd = function Kbd(props: AnyProps) {
    return <kbd {...props} style={{ fontFamily: "var(--font-mono)", fontSize: "11px", background: "var(--surface-recessed)", border: "var(--hairline-w) solid var(--hairline)", borderRadius: 3, padding: "1px 5px", ...(props.style || {}) }} />;
};

export const List = function List(props: AnyProps) { return <ul {...props} style={{ margin: 0, padding: 0, listStyle: "none", ...(props.style || {}) }} />; };
List.Root = List;
List.Item = function ListItem(props: AnyProps) { return <li {...props} />; };

/* ── Card (compound) ────────────────────────────────────────────────────── */

const CardRoot = function CardRoot(props: AnyProps) {
    return (
        <div
            {...props}
            style={{
                background: "var(--surface-panel)",
                borderRadius: "var(--radius-surface)",
                border: "var(--hairline-w) solid var(--hairline)",
                ...(props.style || {}),
            }}
        />
    );
};
CardRoot.Root = CardRoot;
CardRoot.Header = function CardHeader(props: AnyProps) { return <div {...props} style={{ padding: "14px 16px 0" }} />; };
CardRoot.Title = function CardTitle(props: AnyProps) { return <div {...props} style={{ fontSize: "14px", fontWeight: 600, ...(props.style || {}) }} />; };
CardRoot.Body = function CardBody(props: AnyProps) { return <div {...props} style={{ padding: 16 }} />; };
CardRoot.Footer = function CardFooter(props: AnyProps) { return <div {...props} style={{ padding: "0 16px 14px" }} />; };
export const Card = CardRoot;

/* ── Portal (for imperative overlays) ───────────────────────────────────── */

export function Portal(props: { children?: ReactNode; container?: HTMLElement | null }) {
    if (typeof document === "undefined") return null;
    return createPortal(props.children, props.container || document.body);
}

/* ── misc call-site shims ───────────────────────────────────────────────── */

export const Em = function Em(props: AnyProps) { return <em {...props} />; };
export const Strong = function Strong(props: AnyProps) { return <strong {...props} />; };
export const Link = function Link(props: AnyProps) { return <a {...props} style={{ color: "var(--accent-primary)", ...(props.style || {}) }} />; };
export const Icon = function Icon(props: AnyProps) { return <span {...props} style={{ display: "inline-flex", ...(props.style || {}) }} />; };
export const Circle = function Circle(props: AnyProps) {
    const [style, rest] = [(props.style || {}) as CSSProperties, props];
    return <span {...rest} style={{ borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", ...style }} />;
};
export const Wrap = function Wrap(props: AnyProps) { return <div {...props} style={{ display: "flex", flexWrap: "wrap", gap: 8, ...(props.style || {}) }} />; };
export const StackSeparator = null;
export const SliderThumbShim = null;
