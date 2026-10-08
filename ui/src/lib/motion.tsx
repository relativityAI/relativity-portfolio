import { motion, useMotionValue, useSpring, animate, useReducedMotion } from "motion/react"
import { useEffect, useState, type ElementType } from "react"

export const ease: [number, number, number, number] = [0.22, 1, 0.36, 1]
export const dur = { fast: 0.18, base: 0.24, slow: 0.32 }

export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease } },
  exit: { opacity: 0, y: -6, transition: { duration: dur.fast, ease } },
}

export const stagger = {
  animate: { transition: { staggerChildren: 0.045, delayChildren: 0.06 } },
}

export const staggerItem = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease } },
}

export const page = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease } },
  exit: { opacity: 0, y: -6, transition: { duration: dur.fast, ease } },
}

export const swap = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease } },
  exit: { opacity: 0, y: -6, transition: { duration: dur.fast, ease } },
}

export function CountUp({ value, decimals = 1 }: { value: number; decimals?: number }) {
  const mv = useMotionValue(0)
  const spring = useSpring(mv, { damping: 30, stiffness: 90 })
  const [display, setDisplay] = useState(0)
  useEffect(() => { mv.set(value) }, [value, mv])
  useEffect(() => {
    const unsub = spring.on("change", (v: number) => setDisplay(v))
    return () => unsub()
  }, [spring])
  return <>{display.toFixed(decimals)}</>
}

/**
 * Typewriter reveal driven by motion's `animate` (easing + delay), not a rAF loop.
 * The full text stays in the DOM for layout/AT via sr-only; the typed span is aria-hidden.
 */
export function TypeText({
  text, as: Tag = "span", className, delay = 0, cps = 40, caret = true,
}: {
  text: string
  as?: ElementType
  className?: string
  delay?: number
  cps?: number
  caret?: boolean
}) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(0)
  useEffect(() => {
    if (reduced) return
    const controls = animate(0, text.length, {
      duration: text.length / cps,
      delay,
      ease: "linear",
      onUpdate: (v) => setN(Math.round(v)),
    })
    return () => controls.stop()
  }, [text, delay, cps, reduced])
  const count = reduced ? text.length : n
  const done = count >= text.length
  return (
    <Tag className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, count)}
        {caret && !done && (
          <motion.span
            className="inline-block w-px h-[0.9em] bg-current align-[-0.1em] ml-0.5"
            animate={{ opacity: [1, 1, 0, 0] }}
            transition={{ duration: 0.8, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
          />
        )}
      </span>
    </Tag>
  )
}

export { motion }
