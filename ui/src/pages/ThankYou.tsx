import { Flex, Text, Button } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { MdCheckCircleOutline } from "react-icons/md";

export default function ThankYou() {
  return (
    <>
      <Helmet>
        <title>Thank You | Relativity AI</title>
        <meta name="description" content="Your submission has been received." />
      </Helmet>
      <Flex direction="column" align="center" justify="center" minH="60vh" gap={4}>
        <MdCheckCircleOutline size={56} color="var(--signal-positive)" />
        <Text fontSize="2xl" fontWeight="bold">
          Thank you
        </Text>
        <Text color="fg.muted" textAlign="center" maxW="400px">
          Your submission has been received. We'll get back to you shortly.
        </Text>
        <Button asChild variant="solid" colorPalette="blue" mt={2}>
          <Link to="/">Back to home</Link>
        </Button>
      </Flex>
    </>
  );
}
