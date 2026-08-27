import { useState, useEffect } from "react";
import { Box, Flex, Text, Button } from "@chakra-ui/react";
import { SettingsService } from "@/db";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";
import { useNavigate } from "react-router-dom";

export default function ApiKeySetupDialog({ user }: { user: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    
    // Check if keys are set
    SettingsService.getSettings().then((settings) => {
      const keys = settings.llm_keys || {};
      const hasTavily = !!keys.tavily;
      const hasLlm = Object.entries(keys).some(([k, v]) => k !== "tavily" && !!v);
      
      if (!hasLlm || !hasTavily) {
        setIsOpen(true);
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [user]);

  if (!isOpen || loading) return null;

  return (
    <Box position="fixed" inset={0} zIndex={9999} display="flex" alignItems="center" justifyContent="center" bg="blackAlpha.600">
      <Box
        as={motion.div}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: dur.base, ease }}
        bg="var(--surface-panel)"
        border="1px solid var(--hairline)"
        borderRadius="4px"
        w="90%"
        maxW="420px"
        p={6}
        boxShadow="0 12px 32px rgba(0,0,0,0.15)"
      >
        <Text fontSize="16px" fontWeight={600} color="var(--ink-primary)" mb={2}>
          Welcome to Relativity AI
        </Text>
        <Text fontSize="13px" color="var(--ink-secondary)" mb={6}>
          Before you get started, please configure your API keys. You will need an LLM provider key and a Tavily key for web search.
        </Text>

        <Flex justify="flex-end" gap={3} align="center">
          <Button size="xs" variant="ghost" color="var(--ink-tertiary)" onClick={() => setIsOpen(false)}>
            Skip for now
          </Button>
          <Button
            size="sm"
            bg="var(--accent-primary)"
            color="white"
            fontWeight={500}
            _hover={{ opacity: 0.9 }}
            onClick={() => {
              setIsOpen(false);
              navigate("/settings");
            }}
          >
            Go to Settings
          </Button>
        </Flex>
      </Box>
    </Box>
  );
}
