import { Box, Stack, Text } from "@chakra-ui/react";

export interface SkillOption {
  id: string;
  name: string;
  description?: string;
}

export function SkillPicker({
  skills,
  selected,
  onChange,
}: {
  skills: SkillOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <Stack gap={2} data-testid="skill-picker">
      {skills.length === 0 && <Text color="fg.muted" fontSize="sm">No skills available.</Text>}
      {skills.map((s) => (
        <Box key={s.id} as="label" display="flex" gap={2} alignItems="flex-start" cursor="pointer">
          <input
            type="checkbox"
            checked={selected.includes(s.id)}
            onChange={() => toggle(s.id)}
            aria-label={s.name}
          />
          <Box>
            <Text fontWeight="medium">{s.name}</Text>
            {s.description && (
              <Text fontSize="sm" color="fg.muted">
                {s.description}
              </Text>
            )}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}
