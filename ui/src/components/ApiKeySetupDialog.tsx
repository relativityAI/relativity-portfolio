import { useState, useEffect } from "react";
import { Box, Flex, Text, Button } from "@chakra-ui/react";
import { SettingsService } from "@/db";
import { hasRequiredKeys } from "@/utils";
import { MdWarning } from "react-icons/md";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { useNavigate } from "react-router-dom";

const warnedFlag = (userId: string) => `relativity_keys_warned_${userId}`;

export default function ApiKeySetupDialog({ user }: { user: any }) {
  const [dismissed, setDismissed] = useState<boolean>(() => !!user?.id && !!localStorage.getItem(warnedFlag(user.id)));
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || dismissed) return;

    // Check if keys are set
    SettingsService.getSettings().then((settings) => {
      const { hasLlm, hasTavily } = hasRequiredKeys(settings);
      if (!hasLlm || !hasTavily) {
        setIsOpen(true);
      }
    }).catch(console.error);
  }, [user, dismissed]);

  if (dismissed) return null;

  const dismiss = () => {
    if (user?.id) localStorage.setItem(warnedFlag(user.id), "1");
    setDismissed(true);
    setIsOpen(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Box
          position="fixed"
          inset={0}
          zIndex={9999}
          display="flex"
          alignItems="center"
          justifyContent="center"
          bg="blackAlpha.600"
          as={motion.div}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: dur.fast, ease }}
        >
          <Box
            as={motion.div}
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: dur.base, ease }}
            bg="var(--surface-panel)"
            border="1px solid var(--hairline)"
            borderRadius="4px"
            w="90%"
            maxW="420px"
            p={6}
            boxShadow="0 12px 32px rgba(0,0,0,0.15)"
          >
            <Flex align="center" gap={2.5} mb={2}>
              <MdWarning size={22} color="var(--signal-warning)" flexShrink={0} />
              <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)">
                Welcome to Relativity AI
              </Text>
            </Flex>
            <Text fontSize="13px" color="var(--ink-secondary)" mb={6}>
              Set your API keys — you will not be able to use our services until you do. You need an LLM provider key and a Tavily key for web search.
            </Text>

            <Flex justify="flex-end" gap={3} align="center">
              <Button size="xs" variant="subtle" color="var(--ink-tertiary)" onClick={dismiss}>
                Skip for now
              </Button>
              <Button
                size="sm"
                variant="surface"
                colorPalette="blue"
                onClick={() => {
                  dismiss();
                  navigate("/settings");
                }}
              >
                Go to Settings
              </Button>
            </Flex>
          </Box>
        </Box>
      )}
    </AnimatePresence>
  );
}
