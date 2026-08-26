import { Flex } from "@chakra-ui/react";
import { motion } from "motion/react";

export default function TypingIndicator() {
  return (
    <Flex align="center" gap={1.5} py={2} px={1}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--ink-tertiary)",
            display: "inline-block",
          }}
        />
      ))}
    </Flex>
  );
}
