/**
 * Toaster — the Chakra v3 toaster API (`toaster.create({ title, description,
 * type })`) implemented over sonner. All 61 call sites keep compiling.
 */
import { Toaster as SonnerToaster, toast } from "sonner";

type ToastType = "success" | "error" | "info" | "warning" | "loading";

interface CreateArgs {
    title?: string;
    description?: string;
    type?: ToastType;
    duration?: number;
    action?: { label: string; onClick: () => void };
    closable?: boolean;
}

export const toaster = {
    create({ title, description, type = "info", duration, action }: CreateArgs) {
        const opts = {
            description,
            duration: duration ?? 4500,
            action: action ? { label: action.label, onClick: action.onClick } : undefined,
        };
        switch (type) {
            case "success": toast.success(title ?? "", opts); break;
            case "error": toast.error(title ?? "", opts); break;
            case "warning": toast.warning(title ?? "", opts); break;
            case "loading": toast.loading(title ?? "", opts); break;
            default: toast(title ?? "", opts);
        }
    },
    dismiss: (id?: string | number) => toast.dismiss(id),
};

export function Toaster() {
    return (
        <SonnerToaster
            position="bottom-right"
            toastOptions={{
                style: {
                    background: "var(--surface-inverse, #101215)",
                    color: "var(--ink-inverse-primary, #EDEDEC)",
                    border: "var(--hairline-w) solid var(--hairline, #4A525C)",
                    borderRadius: "var(--radius-surface, 4px)",
                    fontSize: "13px",
                },
            }}
        />
    );
}
