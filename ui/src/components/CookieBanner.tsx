import { useState, useEffect } from "react";
import { Flex, Text, Button } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import { dur, ease } from "@/lib/motion";

const COOKIE_KEY = "relativity_cookie_consent";

export default function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(COOKIE_KEY)) {
      setShow(true);
    }
  }, []);

  const accept = () => {
    localStorage.setItem(COOKIE_KEY, "accepted");
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <Flex
          as={motion.div}
          position="fixed"
          bottom={0}
          left={0}
          right={0}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: dur.base, ease }}
          bg="var(--surface-panel)"
          borderTop="1px solid var(--hairline)"
          px={{ base: 4, md: 8 }}
          py={4}
          zIndex={9999}
          direction={{ base: "column", md: "row" }}
          align={{ base: "stretch", md: "center" }}
          justify="space-between"
          gap={4}
        >
          <Text fontSize="sm" color="fg.muted" flex={1}>
            We use cookies to maintain your session and improve the platform.
            By continuing to use Relativity AI, you agree to our{" "}
            <a href="/privacy" style={{ color: "var(--accent-primary)", textDecoration: "underline" }}>Privacy Policy</a>.
          </Text>
          <Button onClick={accept} variant="surface" colorPalette="blue" size="sm" flexShrink={0}>
            Accept
          </Button>
        </Flex>
      )}
    </AnimatePresence>
  );
}