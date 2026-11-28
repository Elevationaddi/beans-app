import { colors, radius, space, touchTarget, typography } from "@beans/ui";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { useI18n } from "../i18n";
import type { ApiFailure } from "../lib/api";
import type { Remote } from "../lib/use-remote";

/** Root of every screen: background, padding, and the Arabic review notice. */
export function Screen({
  children,
  scroll = true,
  testID,
}: {
  children: ReactNode;
  scroll?: boolean;
  testID?: string;
}) {
  const { locale, t } = useI18n();
  const notice =
    locale === "ar" ? (
      <Text style={styles.notice} accessibilityRole="text">
        {t("profile.arabicReview")}
      </Text>
    ) : null;
  return scroll ? (
    <ScrollView testID={testID} style={styles.screen} contentContainerStyle={styles.content}>
      {notice}
      {children}
    </ScrollView>
  ) : (
    <View testID={testID} style={[styles.screen, styles.content]}>
      {notice}
      {children}
    </View>
  );
}

export function Heading({
  children,
  level = 1,
  testID,
}: {
  children: ReactNode;
  level?: 1 | 2;
  testID?: string;
}) {
  return (
    <Text accessibilityRole="header" style={level === 1 ? styles.h1 : styles.h2} testID={testID}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
  testID,
}: {
  children: ReactNode;
  muted?: boolean;
  testID?: string;
}) {
  return (
    <Text testID={testID} style={[styles.body, muted && styles.muted]}>
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  variant = "primary",
  hint,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "destructive";
  hint?: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(hint !== undefined && { accessibilityHint: hint })}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "destructive" && styles.buttonDestructive,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, variant === "secondary" && styles.buttonTextSecondary]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A toggle chip: radio or checkbox semantics, state announced to screen readers. */
export function Chip({
  label,
  selected,
  onPress,
  role = "checkbox",
  disabled = false,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: "checkbox" | "radio" | "switch";
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.buttonDisabled]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {selected ? "✓ " : ""}
        {label}
      </Text>
    </Pressable>
  );
}

/** Status chip: always text, never colour alone (docs/09). */
export function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "error";
}) {
  return (
    <View style={[styles.status, { borderColor: colors[tone] }]}>
      <Text style={[styles.statusText, { color: colors[tone] }]}>{label}</Text>
    </View>
  );
}

/** Loading, error-with-retry and offline/stale states for a remote load. */
export function RemoteState<T>({
  remote,
  children,
  empty,
  isEmpty,
}: {
  remote: Remote<T>;
  children: (data: T) => ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
}) {
  const { t } = useI18n();
  if (remote.loading && remote.data === null) {
    return (
      <View style={styles.center} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.primary} accessibilityLabel={t("common.loading")} />
      </View>
    );
  }
  if (remote.data === null) {
    return (
      <View style={styles.center} accessibilityLiveRegion="assertive">
        <Body>{remote.error?.kind === "offline" ? t("common.offline") : t("common.error")}</Body>
        <Button label={t("common.retry")} onPress={remote.reload} variant="secondary" />
      </View>
    );
  }
  return (
    <View>
      {remote.stale ? (
        <View style={styles.staleRow} accessibilityLiveRegion="polite">
          <Body muted>{t("common.offline")}</Body>
          <Button label={t("common.retry")} onPress={remote.reload} variant="secondary" />
        </View>
      ) : null}
      {isEmpty?.(remote.data) ? empty : children(remote.data)}
    </View>
  );
}

/** In-app confirmation dialog (testable, unlike native alerts). */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.dialog} accessibilityViewIsModal accessibilityRole="alert">
          <Heading level={2}>{title}</Heading>
          <Body>{body}</Body>
          <Button
            label={confirmLabel}
            onPress={onConfirm}
            variant="destructive"
            testID="confirm-dialog-confirm"
          />
          <Button
            label={t("common.cancel")}
            onPress={onCancel}
            variant="secondary"
            testID="confirm-dialog-cancel"
          />
        </View>
      </View>
    </Modal>
  );
}

/** A labelled text field; the label is also the accessible name. */
export function Field({
  label,
  hint,
  error,
  testID,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string | null; testID?: string }) {
  return (
    <View style={{ gap: space[1] }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        {...(hint !== undefined && { accessibilityHint: hint })}
        placeholderTextColor={colors.primary}
        style={[styles.input, input.multiline && { minHeight: 96, textAlignVertical: "top" }]}
        {...input}
      />
      {hint ? <Body muted>{hint}</Body> : null}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** A coloured notice with text (never colour alone). */
export function Notice({
  children,
  tone = "info",
  testID,
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "error" | "success";
  testID?: string;
}) {
  const border =
    tone === "error"
      ? colors.error
      : tone === "warning"
        ? colors.warning
        : tone === "success"
          ? colors.success
          : colors.border;
  return (
    <View
      testID={testID}
      style={[styles.card, { borderColor: border, borderWidth: 2 }]}
      accessibilityLiveRegion={tone === "error" ? "assertive" : "polite"}
    >
      {typeof children === "string" ? <Body>{children}</Body> : children}
    </View>
  );
}

/** The server's message for a failed action, or the offline message. */
export function FailureText({ failure }: { failure: ApiFailure | Error | null }) {
  const { t } = useI18n();
  if (!failure) return null;
  const offline = "kind" in failure && failure.kind === "offline";
  return (
    <Text style={styles.error} accessibilityLiveRegion="assertive" testID="failure">
      {offline ? t("common.offline") : failure.message}
    </Text>
  );
}

export const styles = StyleSheet.create({
  label: { color: colors.ink, fontSize: typography.size.secondary, fontWeight: "600" },
  input: {
    minHeight: touchTarget.android,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: typography.size.body,
    textAlign: "auto",
  },
  error: { color: colors.error, fontSize: typography.size.secondary },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space[4], gap: space[3] },
  notice: {
    backgroundColor: colors.surface,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[2],
    color: colors.ink,
    fontSize: typography.size.secondary,
  },
  h1: {
    color: colors.ink,
    fontSize: typography.size.headline,
    fontWeight: "700",
    textAlign: "auto",
  },
  h2: {
    color: colors.ink,
    fontSize: typography.size.section,
    fontWeight: "600",
    textAlign: "auto",
  },
  body: { color: colors.ink, fontSize: typography.size.body, textAlign: "auto" },
  muted: { color: colors.primary, fontSize: typography.size.secondary },
  button: {
    minHeight: touchTarget.android,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    justifyContent: "center",
    alignItems: "center",
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  buttonDestructive: { backgroundColor: colors.error },
  buttonDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  buttonText: { color: colors.surface, fontSize: typography.size.body, fontWeight: "600" },
  buttonTextSecondary: { color: colors.primary },
  chip: {
    minHeight: touchTarget.ios,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space[3],
    justifyContent: "center",
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.background },
  chipText: { color: colors.ink, fontSize: typography.size.secondary },
  chipTextSelected: { color: colors.primary, fontWeight: "600" },
  status: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space[2],
    alignSelf: "flex-start",
  },
  statusText: { fontSize: typography.size.caption, fontWeight: "600" },
  center: { padding: space[6], alignItems: "center", gap: space[3] },
  staleRow: { gap: space[2], marginBottom: space[3] },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: space[4],
  },
  dialog: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space[4],
    gap: space[3],
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[4],
    gap: space[2],
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2], alignItems: "center" },
});
