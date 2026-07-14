import { Flex, Text } from "@chakra-ui/react"

interface SectionBlockProps {
  sectionId: string;
  subsectionId?: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

export default function SectionBlock({ sectionId, subsectionId, title, description, children }: SectionBlockProps) {
  return (
    <Flex
      direction="column"
      gap={4}
      pt={6}
      pb={8}
      borderBottom="1px solid"
      borderColor="border"
      _last={{ borderBottom: "none" }}
      data-section={sectionId}
      {...(subsectionId ? { "data-subsection": subsectionId } : {})}
    >
      <Text fontSize="sm" fontWeight="bold" color="fg">
        {title}
      </Text>
      <Text fontSize="xs" color="fg.muted" lineHeight="short" mt={-1}>
        {description}
      </Text>
      {children}
    </Flex>
  )
}
