import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { APP_SURFACES } from "@beans/contracts";
import { colors, radius, space, typography } from "@beans/ui";

export default function App() {
  return (
    <View style={styles.container}>
      <View style={styles.card} accessibilityRole="summary">
        <Text style={styles.title} accessibilityRole="header">
          {APP_SURFACES.mobile.title}
        </Text>
        <Text style={styles.body}>
          Foundation build. Browsing, ordering and payments are not built yet.
        </Text>
      </View>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: space[4],
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space[6],
    maxWidth: 480,
  },
  title: {
    color: colors.primary,
    fontSize: typography.size.headline,
    fontWeight: "700",
    marginBottom: space[2],
  },
  body: {
    color: colors.ink,
    fontSize: typography.size.body,
  },
});
