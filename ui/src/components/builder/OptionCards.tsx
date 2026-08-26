import { Flex, Text } from "@chakra-ui/react";
import { motion } from "motion/react";
import { dur, ease } from "@/lib/motion";

interface Option {
  id: string;
  label: string;
  description?: string;
}

interface OptionCardsProps {
  options: Option[];
  onSelect: (option: Option) => void;
  disabled?: boolean;
}

export default function OptionCards({ options, onSelect, disabled }: OptionCardsProps) {
  return (
    <Flex direction="column" gap={2} mt={2}>
      {options.map((opt, i) => (
        <motion.button
          key={opt.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: dur.base, ease, delay: i * 0.05 }}
          whileHover={{ scale: 1.01, x: 2 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => !disabled && onSelect(opt)}
          disabled={disabled}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 2,
            padding: "10px 14px",
            borderRadius: "4px",
            border: "1px solid var(--hairline)",
            background: "var(--surface-panel)",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.5 : 1,
            textAlign: "left",
            width: "100%",
            transition: "border-color 150ms, background 150ms",
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              e.currentTarget.style.borderColor = "var(--accent-primary)";
              e.currentTarget.style.background = "var(--surface-recessed)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--hairline)";
            e.currentTarget.style.background = "var(--surface-panel)";
          }}
        >
          <Text fontSize="13px" fontWeight={500} color="var(--ink-primary)">
            {opt.label}
          </Text>
          {opt.description && (
            <Text fontSize="12px" color="var(--ink-secondary)" lineHeight="short">
              {opt.description}
            </Text>
          )}
        </motion.button>
      ))}
    </Flex>
  );
}
