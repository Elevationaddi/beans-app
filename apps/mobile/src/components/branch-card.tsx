import type { BranchAvailability, PublicBranchCard } from "@beans/contracts";
import { Pressable, Text, View } from "react-native";
import { localized, type MessageKey, useI18n } from "../i18n";
import { Body, StatusChip, styles } from "./ui";

export const availabilityText: Record<BranchAvailability, MessageKey> = {
  open: "availability.open",
  closed: "availability.closed",
  paused: "availability.paused",
};
const tone = { open: "success", closed: "warning", paused: "error" } as const;

export function BranchCard({ branch, onPress }: { branch: PublicBranchCard; onPress: () => void }) {
  const { t, locale } = useI18n();
  const name = localized(branch.names, locale);
  const status = t(availabilityText[branch.availability]);
  const distance =
    branch.distanceMeters !== null
      ? t("explore.distanceKm", { km: (Math.round(branch.distanceMeters / 100) / 10).toFixed(1) })
      : null;
  return (
    <Pressable
      testID={`branch-card-${branch.id}`}
      accessibilityRole="button"
      accessibilityLabel={[branch.brandName, name, status, distance].filter(Boolean).join(", ")}
      onPress={onPress}
      style={styles.card}
    >
      <Text style={styles.h2}>{branch.brandName}</Text>
      <Body>{name}</Body>
      <View style={styles.row}>
        <StatusChip label={status} tone={tone[branch.availability]} />
        {distance ? <Body muted>{distance}</Body> : null}
      </View>
      <Body muted>{branch.address}</Body>
    </Pressable>
  );
}
