import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MdCheck } from "react-icons/md";

const font = "var(--font-body)";
const ink1 = "var(--ink-primary)";
const ink2 = "var(--ink-secondary)";
const ink3 = "var(--ink-tertiary)";
const panel = "var(--surface-panel)";
const recessed = "var(--surface-recessed)";
const hairline = "var(--hairline)";
const positive = "var(--signal-positive)";
const canvas = "var(--surface-canvas)";

export function MenuDropdown({ value, placeholder, search, logo, children }: {
    value: string | null;
    placeholder: string;
    /** In-place search: the trigger itself is the text input — no header block in the panel. */
    search?: { value: string; onChange: (v: string) => void; placeholder?: string };
    /** Optional icon shown before the trigger's value. */
    logo?: ReactNode;
    children: (close: () => void) => ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const [refocusTick, setRefocusTick] = useState(0);
    const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);

    const close = useCallback(() => {
        if (panelEl && panelEl.contains(document.activeElement)) setRefocusTick((t) => t + 1);
        setOpen(false);
    }, [panelEl]);

    useEffect(() => {
        if (refocusTick > 0 && !open) {
            const target = rootRef.current?.querySelector("input") ?? triggerRef.current;
            target?.focus();
        }
    }, [refocusTick, open]);

    // Closing (selection, outside click, Escape) always starts the next open fresh.
    useEffect(() => {
        if (!open) search?.onChange("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const focusOption = useCallback((idx: number) => {
        const opts = Array.from(panelEl?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
        if (!opts.length) return;
        const i = Math.min(Math.max(idx, 0), opts.length - 1);
        opts[i].focus();
        opts[i].scrollIntoView({ block: "nearest" });
    }, [panelEl]);

    useEffect(() => {
        if (open) {
            // Searchable panels open straight into their own text input (the
            // trigger); plain lists land on the first option.
            const input = rootRef.current?.querySelector("input");
            if (input) {
                input.focus();
                return;
            }
            const opts = Array.from(panelEl?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
            const current = opts.indexOf(document.activeElement as HTMLElement);
            focusOption(current >= 0 ? current : 0);
        }
    }, [open, focusOption, panelEl]);

    const onTriggerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Escape" && open) {
            e.preventDefault();
            close();
            return;
        }
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            if (!open) {
                e.preventDefault();
                setOpen(true);
            } else if (e.target instanceof HTMLInputElement && e.key === "ArrowDown") {
                e.preventDefault();
                focusOption(0);
            }
        }
    };

    const moveOption = (delta: number) => {
        const opts = Array.from(panelEl?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
        const cur = opts.indexOf(document.activeElement as HTMLElement);
        focusOption(cur + delta);
    };

    const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            moveOption(e.key === "ArrowDown" ? 1 : -1);
        } else if (e.key === "Escape") {
            e.preventDefault();
            close();
        } else if (e.key === "Tab") {
            setOpen(false);
        }
    };

    return (
        <div ref={rootRef} style={{ position: "relative" }}>
            <motion.div
                ref={triggerRef}
                role={search ? undefined : "button"}
                tabIndex={search ? undefined : 0}
                aria-expanded={search ? undefined : open}
                aria-haspopup={search ? undefined : "listbox"}
                onClick={() => (search ? setOpen(true) : setOpen((o) => !o))}
                onFocus={search ? () => setOpen(true) : undefined}
                onKeyDown={onTriggerKeyDown}
                whileTap={{ scale: 0.997 }}
                className="flex cursor-pointer items-center gap-1.5 transition-opacity hover:opacity-70"
                style={{
                    padding: "4px 0",
                    minHeight: "30px",
                    outline: "none",
                    borderTop: "0.5px solid var(--hairline)",
                }}
            >
                {logo && <span style={{ display: "inline-flex", flexShrink: 0, marginRight: 2 }}>{logo}</span>}
                {search ? (
                    <input
                        value={open ? search.value : (value ?? "")}
                        placeholder={open ? (search.placeholder ?? placeholder) : placeholder}
                        onChange={(e) => search.onChange(e.target.value)}
                        aria-label={placeholder}
                        aria-expanded={open}
                        aria-haspopup="listbox"
                        style={{
                            flex: 1,
                            minWidth: 0,
                            border: "none",
                            outline: "none",
                            background: "transparent",
                            padding: 0,
                            fontSize: "14px",
                            fontFamily: font,
                            fontWeight: 400,
                            color: ink1,
                        }}
                    />
                ) : (
                    <span
                        style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontSize: "14px",
                            fontFamily: font,
                            fontWeight: 400,
                            color: value ? ink1 : ink3,
                        }}
                    >
                        {value || placeholder}
                    </span>
                )}
                <motion.span
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={{ type: "spring", bounce: 0, duration: 0.25 }}
                    style={{ display: "inline-flex", flexShrink: 0, color: ink3 }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </motion.span>
            </motion.div>
            <AnimatePresence>
                {open && (
                    <motion.div
                        ref={setPanelEl}
                        role="listbox"
                        tabIndex={-1}
                        initial={{ opacity: 0, scale: 0.985, y: -3 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.99, y: -2, transition: { duration: 0.12, ease: "easeOut" } }}
                        transition={{ type: "spring", bounce: 0, duration: 0.25 }}
                        onKeyDown={onPanelKeyDown}
                        style={{
                            position: "absolute",
                            top: "calc(100% + 6px)",
                            left: 0,
                            right: 0,
                            zIndex: 50,
                            transformOrigin: "top left",
                            background: canvas,
                            border: `1px solid ${hairline}`,
                            borderRadius: "0",
                            maxHeight: "280px",
                            overflowY: "auto",
                            outline: "none",
                        }}
                    >
                        {children(close)}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export function DropdownItem({ label, sub, selected, logo, onClick }: {
    label: string;
    sub?: string;
    selected?: boolean;
    logo?: ReactNode;
    onClick: () => void;
}) {
    return (
        <motion.button
            type="button"
            role="option"
            aria-selected={selected}
            tabIndex={-1}
            whileTap={{ scale: 0.99 }}
            transition={{ type: "spring", bounce: 0, duration: 0.12 }}
            onClick={onClick}
            style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                border: "none",
                borderRadius: "0",
                background: "transparent",
                cursor: "pointer",
                outline: "none",
            }}
        >
            {logo && <span style={{ display: "inline-flex", flexShrink: 0 }}>{logo}</span>}
            <span style={{ flex: 1, minWidth: 0 }}>
                <span
                    style={{
                        display: "block",
                        fontSize: "13px",
                        fontFamily: font,
                        fontWeight: selected ? 500 : 400,
                        color: ink1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {label}
                </span>
                {sub && (
                    <span
                        style={{
                            display: "block",
                            fontSize: "11px",
                            fontWeight: 300,
                            fontFamily: font,
                            color: ink3,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {sub}
                    </span>
                )}
            </span>
            {selected && (
                <motion.span
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", bounce: 0.3, duration: 0.25 }}
                    style={{ display: "inline-flex", flexShrink: 0 }}
                >
                    <MdCheck size={13} color={positive} />
                </motion.span>
            )}
        </motion.button>
    );
}

type PressButtonProps = {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    flex?: boolean;
    style?: React.CSSProperties;
};

export function PrimaryButton({ children, onClick, disabled, flex, style }: PressButtonProps) {
    return (
        <motion.button
            type="button"
            data-solid=""
            disabled={disabled}
            onClick={onClick}
            whileTap={disabled ? undefined : { scale: 0.98 }}
            transition={{ type: "spring", bounce: 0, duration: 0.15 }}
            style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                flex: flex ? 1 : undefined,
                width: flex ? undefined : "100%",
                height: "44px",
                padding: "0 18px",
                background: disabled ? recessed : ink1,
                color: disabled ? ink3 : canvas,
                border: "none",
                borderRadius: "0",
                fontFamily: font,
                fontWeight: 500,
                fontSize: "14px",
                cursor: disabled ? "default" : "pointer",
                outline: "none",
                boxShadow: disabled
                    ? "none"
                    : `inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 2px color-mix(in srgb, ${ink1} 14%, transparent)`,
                ...style,
            }}
        >
            {children}
        </motion.button>
    );
}

export function SecondaryButton({ children, onClick, disabled, flex, style }: PressButtonProps) {
    return (
        <motion.button
            type="button"
            data-solid=""
            disabled={disabled}
            onClick={onClick}
            whileTap={disabled ? undefined : { scale: 0.98 }}
            transition={{ type: "spring", bounce: 0, duration: 0.15 }}
            style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                flex: flex ? 1 : undefined,
                height: "38px",
                padding: "0 16px",
                background: panel,
                color: ink2,
                border: `1px solid ${hairline}`,
                borderRadius: "0",
                fontFamily: font,
                fontWeight: 500,
                fontSize: "13px",
                cursor: disabled ? "default" : "pointer",
                outline: "none",
                ...style,
            }}
        >
            {children}
        </motion.button>
    );
}

export function ResumingButton({ children }: { children: ReactNode }) {
    return (
        <button
            type="button"
            data-solid=""
            disabled
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                width: "100%",
                height: "44px",
                background: recessed,
                color: ink3,
                border: "none",
                borderRadius: "0",
                fontFamily: font,
                fontWeight: 500,
                fontSize: "14px",
                cursor: "default",
            }}
        >
            {children}
        </button>
    );
}
