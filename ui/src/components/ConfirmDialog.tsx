import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { dur, ease } from "@/lib/motion";

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onCancel: () => void;
    onConfirm: () => void;
}

/**
 * Flat confirm sheet — hairline border, square corners, Anek Latin, the same
 * outline-cancel / solid-confirm pairing the rest of the app uses for
 * secondary and primary actions. No rounded chips, no Chakra chrome.
 */
export default function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel = "Delete",
    onCancel,
    onConfirm,
}: ConfirmDialogProps) {
    return (
        <AnimatePresence>
            {open && (
                <div
                    className="fixed inset-0 z-[1400] flex items-center justify-center p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label={title}
                >
                    <motion.div
                        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: dur.fast, ease }}
                        onClick={onCancel}
                    />
                    <motion.div
                        className="relative w-full max-w-[400px] border border-[var(--hairline)] bg-[var(--surface-panel)] shadow-[0_16px_48px_rgba(0,0,0,0.18)]"
                        initial={{ opacity: 0, scale: 0.97, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 6 }}
                        transition={{ duration: dur.base, ease }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-3 px-5 pt-4">
                            <h2 className="font-app-body text-[15px] leading-snug font-medium text-[var(--ink-primary)]">
                                {title}
                            </h2>
                            <button
                                type="button"
                                aria-label="Close"
                                onClick={onCancel}
                                className="-mt-1 -mr-1 p-1 text-[var(--ink-tertiary)] transition-colors hover:text-[var(--ink-primary)]"
                            >
                                <X className="size-4" />
                            </button>
                        </div>
                        <p className="px-5 pt-2 pb-5 font-app-body text-[13px] leading-relaxed font-light text-[var(--ink-secondary)]">
                            {message}
                        </p>
                        <div className="flex justify-end gap-2 border-t border-[var(--hairline)] px-5 py-3.5">
                            <button
                                type="button"
                                onClick={onCancel}
                                className="h-9 rounded-[3px] border border-[var(--hairline)] bg-transparent px-4 font-app-body text-[13px] font-normal text-[var(--ink-secondary)] transition-colors hover:border-[var(--ink-tertiary)] hover:text-[var(--ink-primary)]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={onConfirm}
                                className="h-9 rounded-[3px] bg-[var(--signal-negative)] px-4 font-app-body text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                            >
                                {confirmLabel}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
