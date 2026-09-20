import { motion, useMotionValue, useSpring } from "motion/react"
import { useEffect, useState } from "react"

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

export { motion }
