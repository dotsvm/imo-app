/** What imo tells you about, one switch each. Some (failed orders) stay on for safety. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import type { PreferencesDTO } from "@imo/server/dto/api-types";
import { Skeleton } from "~/components/skeleton";
import { api } from "~/lib/api";
import { color, font, radius, space, text } from "~/theme/tokens";

export default function NotificationSettings() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: ["notification-preferences"], queryFn: ({ signal }) => api<PreferencesDTO>("/me/notification-preferences", { signal }) });

  async function set(id: string, app: boolean) {
    queryClient.setQueryData<PreferencesDTO>(["notification-preferences"], (d) =>
      d ? { ...d, items: d.items.map((p) => (p.id === id ? { ...p, app } : p)) } : d,
    );
    try {
      await api(`/me/notification-preferences/${id}`, { method: "PATCH", body: { app } });
    } catch {
      queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
    }
  }

  const items = prefs.data?.items ?? [];
  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[1] }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: space[4], paddingBottom: insets.bottom + space[6] }}>
        <View style={styles.group}>
          {prefs.isPending
            ? [0, 1, 2, 3].map((i) => (
                <View key={i} style={[styles.row, styles.rowLine]}>
                  <Skeleton width="60%" height={13} />
                </View>
              ))
            : items.map((p, i) => (
                <View key={p.id} style={[styles.row, i < items.length - 1 && styles.rowLine]}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.label}>{p.label}</Text>
                    <Text style={styles.small}>{p.description}</Text>
                  </View>
                  <Switch
                    value={p.app}
                    onValueChange={(v) => set(p.id, v)}
                    disabled={"locked" in p && !!p.locked}
                    trackColor={{ false: color.neutral400, true: "#7fd47a" }}
                    thumbColor="#f3f1ea"
                    ios_backgroundColor={color.neutral400}
                    accessibilityLabel={p.label}
                  />
                </View>
              ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3] },
  back: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: font.medium, fontSize: 26, letterSpacing: -0.7, color: color.text },
  group: { borderRadius: radius.panel, backgroundColor: "#121714", overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 60, paddingHorizontal: space[4], paddingVertical: space[2] },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.neutral300 },
  label: { fontFamily: font.regular, fontSize: text.body + 1, color: color.text },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.neutral700 },
});
