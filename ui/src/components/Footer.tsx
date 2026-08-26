import { Flex, Text } from "@chakra-ui/react";
import { Link } from "react-router-dom";

export default function Footer() {
  return (
    <Flex
      as="footer"
      px={{ base: 4, md: 16 }}
      py={6}
      mt={8}
      borderTop="1px solid var(--hairline)"
      justify="space-between"
      align="center"
      direction={{ base: "column", md: "row" }}
      gap={3}
    >
      <Text fontSize="xs" color="fg.muted">
        &copy; {new Date().getFullYear()} Relativity AI
      </Text>
      <Flex gap={4}>
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
