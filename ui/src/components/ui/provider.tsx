"use client"

import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react"
import {
  ColorModeProvider,
  type ColorModeProviderProps,
} from "./color-mode"

const system = createSystem(defaultConfig, {
  theme: {
    tokens: {
      fonts: {
        heading: { value: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" },
        body: { value: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" },
        mono: { value: "'IBM Plex Mono', 'SF Mono', monospace" },
      },
    },
  },
})

export function Provider(props: ColorModeProviderProps) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider {...props} />
    </ChakraProvider>
  )
}
