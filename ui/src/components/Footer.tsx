import { Flex, Text } from "@chakra-ui/react";
import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <Flex
      as="footer"
      px={{ base: 4, md: 16 }}
      py={{ base: 3, md: 5 }}
      mt={4}
      borderTop="1px solid var(--hairline)"
      justify="space-between"
      align="center"
      gap={3}
      flexWrap={{ base: "wrap", md: "nowrap" }}
    >
      <Text fontSize="xs" color="fg.muted">
        &copy; {new Date().getFullYear()} Relativity AI
      </Text>
      <Flex gap={{ base: 3, md: 4 }} align="center">
        <Text
          as={Link}
          to="/guide"
          fontSize="xs"
          color="fg.muted"
          _hover={{ color: "fg" }}
        >
          Guide
        </Text>
        <Text
          as={Link}
          to="/privacy"
          fontSize="xs"
          color="fg.muted"
          _hover={{ color: "fg" }}
        >
          Privacy
        </Text>
        <Text
          as={Link}
          to="/terms"
          fontSize="xs"
          color="fg.muted"
          _hover={{ color: "fg" }}
        >
          Terms
        </Text>
      </Flex>
    </Flex>
  );
}
