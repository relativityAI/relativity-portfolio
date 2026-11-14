import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const ProgressContext = React.createContext<number | null>(null)

/**
 * Progress bar with an optional label/value row:
 *
 *   <Progress value={56}>
 *     <ProgressLabel>Upload progress</ProgressLabel>
 *     <ProgressValue />
 *   </Progress>
 *
 * Pass `value={null}` (or omit it) for work whose length isn't known yet — the
 * bar renders as an indeterminate sweep instead of a false percentage.
 */
function Progress({
  className,
  value,
  max = 100,
  children,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  value?: number | null
  children?: React.ReactNode
}) {
  const pct =
    value == null || Number.isNaN(Number(value))
      ? null
      : Math.max(0, Math.min(100, Math.round(Number(value))))

  return (
    <ProgressContext.Provider value={pct}>
      <ProgressPrimitive.Root
        data-slot="progress"
        value={pct ?? undefined}
        max={max}
        className={cn("flex w-full flex-col gap-1.5", className)}
        {...props}
      >
        {children ? (
          <div className="flex items-baseline justify-between gap-3 text-[12px]">
            {children}
          </div>
        ) : null}
        {/* radix progress has no Track part; Root supplies the context, so a plain div wraps the Indicator */}
        <div
          data-slot="progress-track"
          className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15"
        >
          <ProgressPrimitive.Indicator
            data-slot="progress-indicator"
            className={cn(
              "h-full rounded-full bg-primary transition-[transform] duration-700 ease-out",
              pct == null ? "w-1/3 animate-pulse" : "w-full"
            )}
            style={pct == null ? undefined : { transform: `translateX(-${100 - pct}%)` }}
          />
        </div>
      </ProgressPrimitive.Root>
    </ProgressContext.Provider>
  )
}

function ProgressLabel({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="progress-label"
      className={cn("truncate font-medium text-muted-foreground", className)}
      {...props}
    >
      {children}
    </span>
  )
}

function ProgressValue({ className, ...props }: React.ComponentProps<"span">) {
  const value = React.useContext(ProgressContext)
  return (
    <span
      data-slot="progress-value"
      className={cn(
        "shrink-0 font-medium tabular-nums text-muted-foreground",
        className
      )}
      {...props}
    >
      {value == null ? "" : `${value}%`}
    </span>
  )
}

export { Progress, ProgressLabel, ProgressValue }
