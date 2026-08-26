import { Box, Text, Heading } from "@chakra-ui/react";
import { Helmet } from "react-helmet-async";

export default function Privacy() {
  return (
    <>
      <Helmet>
        <title>Privacy Policy | Relativity AI</title>
        <meta name="description" content="Relativity AI privacy policy. Learn how we handle your data." />
      </Helmet>
      <Box maxW="720px" mx="auto" py={10}>
        <Heading size="xl" mb={2}>Privacy Policy</Heading>
        <Text fontSize="sm" color="fg.muted" mb={8}>Last updated: {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</Text>

        <Heading size="md" mb={3}>1. Information We Collect</Heading>
        <Text mb={6} lineHeight="tall">
          We collect your Google account information (name, email, profile picture) when you sign in via Google OAuth.
          We also store analysis configurations and results you create within the platform.
        </Text>

        <Heading size="md" mb={3}>2. How We Use Your Information</Heading>
        <Text mb={6} lineHeight="tall">
          Your information is used solely to provide and improve the Relativity AI service.
          We do not sell, trade, or otherwise transfer your personal information to third parties.
        </Text>

        <Heading size="md" mb={3}>3. API Keys</Heading>
        <Text mb={6} lineHeight="tall">
          Any API keys you provide for LLM providers are encrypted at rest and only used to make requests on your behalf.
          They are never shared with third parties.
        </Text>

        <Heading size="md" mb={3}>4. Data Security</Heading>
        <Text mb={6} lineHeight="tall">
          We implement industry-standard security measures to protect your data.
          All data is transmitted over encrypted connections.
        </Text>

        <Heading size="md" mb={3}>5. Changes to This Policy</Heading>
        <Text mb={6} lineHeight="tall">
          We may update this privacy policy from time to time. Continued use of the service constitutes acceptance of any changes.
        </Text>

        <Heading size="md" mb={3}>6. Contact</Heading>
        <Text lineHeight="tall">
          Questions about this policy? Reach out through the platform's support channels.
        </Text>
      </Box>
    </>
  );
}
