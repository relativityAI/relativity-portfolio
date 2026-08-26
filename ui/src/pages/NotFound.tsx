import { Flex, Text, Button } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";

export default function NotFound() {
  return (
    <>
      <Helmet>
        <title>Page Not Found | Relativity AI</title>
        <meta name="description" content="The page you're looking for doesn't exist." />
      </Helmet>
      <Flex direction="column" align="center" justify="center" minH="60vh" gap={4}>
        <Text fontSize="6xl" fontWeight="bold" fontFamily="var(--font-mono)" color="fg.muted">
          404
        </Text>
        <Text fontSize="lg" color="fg.muted">
          This page doesn't exist.
        </Text>
        <Button asChild variant="solid" colorPalette="blue" mt={2}>
          <Link to="/">Go home</Link>
        </Button>
      </Flex>
    </>
  );
}
