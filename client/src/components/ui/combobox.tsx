"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, SearchIcon, XIcon } from "lucide-react"
import { Command as CommandPrimitive } from "cmdk"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/**
 * Combobox — a searchable select in the shadcn mould.
 *
 * The API follows the reference component: a root that owns the option list
 * (`items`, `value`, `onValueChange`), a trigger input with an optional clear,
 * and a content made of a search field, an empty state and a list whose
 * children are a render function over the items.
 *
 * `filter` switches between client-side filtering (default, cmdk does the
 * work) and server-side results — pass `false` plus `onQueryChange` when the
 * caller fetches its own options.
 */

type ComboboxContextValue = {
    items: any[]
    value: string
    display: string
    onValueChange: (value: string) => void
    query: string
    setQuery: (query: string) => void
    open: boolean
    setOpen: (open: boolean) => void
    itemToValue: (item: any) => string
    itemToString: (item: any) => string
    filter: boolean
}

const ComboboxContext = React.createContext<ComboboxContextValue | null>(null)

function useCombobox(): ComboboxContextValue {
    const ctx = React.useContext(ComboboxContext)
    if (!ctx) throw new Error("Combobox parts must be used inside <Combobox>")
    return ctx
}

function defaultToValue(item: any): string {
    if (typeof item === "string") return item
    return String(item?.value ?? item?.id ?? item?._id ?? item?.label ?? "")
}

function defaultToString(item: any): string {
    if (typeof item === "string") return item
    return String(item?.label ?? item?.name ?? item?.title ?? item ?? "")
}

interface ComboboxProps extends Omit<React.ComponentProps<"div">, "onChange"> {
    items?: any[]
    value?: string
    defaultValue?: string
    onValueChange?: (value: string) => void
    /** Fires on every keystroke — wire it up for server-side search. */
    onQueryChange?: (query: string) => void
    itemToValue?: (item: any) => string
    itemToString?: (item: any) => string
    /** Text shown in the trigger; defaults to the selected item's label. */
    displayValue?: string
    /** Client-side filtering (default). Set false when items come from a server. */
    filter?: boolean
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

function Combobox({
    items = [],
    value,
    defaultValue = "",
    onValueChange,
    onQueryChange,
    itemToValue,
    itemToString,
    displayValue,
    filter = true,
    open: openProp,
    onOpenChange,
    children,
    className,
    ...props
}: ComboboxProps) {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
    const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
    const [query, setQueryState] = React.useState("")

    const open = openProp ?? uncontrolledOpen
    const selected = value ?? uncontrolledValue

    const setOpen = React.useCallback(
        (next: boolean) => {
            if (openProp === undefined) setUncontrolledOpen(next)
            onOpenChange?.(next)
            if (!next) {
                setQueryState("")
                onQueryChange?.("")
            }
        },
        [openProp, onOpenChange, onQueryChange]
    )

    const setQuery = React.useCallback(
        (next: string) => {
            setQueryState(next)
            onQueryChange?.(next)
        },
        [onQueryChange]
    )

    const handleValueChange = React.useCallback(
        (next: string) => {
            if (value === undefined) setUncontrolledValue(next)
            onValueChange?.(next)
        },
        [value, onValueChange]
    )

    const toValue = React.useCallback(
        (item: any) => (itemToValue ? itemToValue(item) : defaultToValue(item)),
        [itemToValue]
    )
    const toString = React.useCallback(
        (item: any) => (itemToString ? itemToString(item) : defaultToString(item)),
        [itemToString]
    )

    const display = React.useMemo(() => {
        if (displayValue !== undefined) return displayValue
        if (!selected) return ""
        const found = items.find((item) => toValue(item) === selected)
        return found ? toString(found) : ""
    }, [displayValue, selected, items, toValue, toString])

    const ctx: ComboboxContextValue = {
        items,
        value: selected,
        display,
        onValueChange: handleValueChange,
        query,
        setQuery,
        open,
        setOpen,
        itemToValue: toValue,
        itemToString: toString,
        filter,
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <ComboboxContext.Provider value={ctx}>
                <div className={cn("w-full", className)} {...props}>
                    {children}
                </div>
            </ComboboxContext.Provider>
        </Popover>
    )
}

function ComboboxInput({
    placeholder = "Search…",
    showClear = false,
    disabled,
    className,
}: {
    placeholder?: string
    showClear?: boolean
    disabled?: boolean
    className?: string
}) {
    const { display, open, onValueChange, setQuery } = useCombobox()

    return (
        <div className={cn("relative", className)}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    role="combobox"
                    aria-expanded={open}
                    aria-haspopup="listbox"
                    className={cn(
                        "flex h-9 w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm shadow-xs transition-colors outline-none hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
                        open && "border-ring ring-[3px] ring-ring/50"
                    )}
                >
                    <span
                        className={cn(
                            "min-w-0 flex-1 truncate",
                            !display && "text-muted-foreground"
                        )}
                    >
                        {display || placeholder}
                    </span>
                    <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            {showClear && !!display && (
                <button
                    type="button"
                    aria-label="Clear selection"
                    onClick={() => {
                        onValueChange("")
                        setQuery("")
                    }}
                    className="absolute top-1/2 right-8 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    <XIcon className="size-3.5" />
                </button>
            )}
        </div>
    )
}

function ComboboxContent({
    className,
    children,
    ...props
}: React.ComponentProps<typeof PopoverContent>) {
    const { query, setQuery, filter } = useCombobox()

    return (
        <PopoverContent
            align="start"
            sideOffset={4}
            className={cn(
                "w-[var(--radix-popover-trigger-width)] min-w-[15rem] overflow-hidden p-0",
                className
            )}
            {...props}
        >
            <CommandPrimitive
                shouldFilter={filter}
                className="flex w-full flex-col overflow-hidden bg-popover text-popover-foreground"
            >
                <div className="flex h-9 items-center gap-2 border-b px-3">
                    <SearchIcon className="size-4 shrink-0 text-muted-foreground opacity-50" />
                    <CommandPrimitive.Input
                        value={query}
                        onValueChange={setQuery}
                        autoFocus
                        placeholder="Type to search…"
                        aria-label="Search options"
                        className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                </div>
                {children}
            </CommandPrimitive>
        </PopoverContent>
    )
}

function ComboboxEmpty({
    className,
    children,
}: {
    className?: string
    children?: React.ReactNode
}) {
    return (
        <CommandPrimitive.Empty
            className={cn("py-6 text-center text-sm text-muted-foreground", className)}
        >
            {children ?? "No options found."}
        </CommandPrimitive.Empty>
    )
}

function ComboboxList({
    className,
    children,
}: {
    className?: string
    children: React.ReactNode | ((item: any, index: number) => React.ReactNode)
}) {
    const { items } = useCombobox()
    return (
        <CommandPrimitive.List
            className={cn("max-h-[280px] overflow-x-hidden overflow-y-auto py-1", className)}
        >
            {typeof children === "function"
                ? items.map((item, index) => children(item, index))
                : children}
        </CommandPrimitive.List>
    )
}

function ComboboxItem({
    value,
    searchText,
    className,
    children,
    ...props
}: {
    value: string
    /** Text cmdk filters on — defaults to `value`. */
    searchText?: string
    className?: string
    children?: React.ReactNode
}) {
    const ctx = useCombobox()
    const selected = ctx.value === value

    return (
        <CommandPrimitive.Item
            value={searchText ?? value}
            onSelect={() => {
                ctx.onValueChange(value)
                ctx.setQuery("")
                ctx.setOpen(false)
            }}
            className={cn(
                "relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                className
            )}
            {...props}
        >
            {children}
            {selected && <CheckIcon className="ml-auto size-4 shrink-0" />}
        </CommandPrimitive.Item>
    )
}

export {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
}
