/** What imo tells you about, one switch each. Some (failed orders) stay on for safety. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { PreferencesDTO } from "@imo/server/dto/api-types";
import { ScreenHeader } from "~/components/screen-header";
import { Skeleton } from "~/components/skeleton";
import { Toggle } from "~/components/toggle";
import { Notice } from "~/features/home/notice";
import { api } from "~/lib/api";
import { color, font } from "~/theme/tokens";

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
    <View style={styles.screen}>
      <ScreenHeader title="Notifications" />
      {prefs.isError ? (
        <Notice title="Settings didn't load" body={prefs.error.message} action={{ label: "Try again", onPress: () => prefs.refetch() }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}>
          <View style={styles.group}>
            {prefs.isPending
              ? [0, 1, 2, 3].map((i) => (
                  <View key={i} style={[styles.row, i < 3 && styles.rowLine]}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Skeleton width="50%" height={13} />
                      <Skeleton width="75%" height={10} />
                    </View>
                  </View>
                ))
              : items.map((p, i) => {
                  const locked = "locked" in p && !!p.locked;
                  return (
                    <View key={p.id} style={[styles.row, i < items.length - 1 && styles.rowLine]}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={styles.label}>{p.label}</Text>
                        <Text style={styles.small}>{p.description}</Text>
                      </View>
                      <Toggle value={p.app} onChange={(v) => set(p.id, v)} disabled={locked} label={p.label} />
                    </View>
                  );
                })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  group: { borderRadius: 18, backgroundColor: color.card, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: "rgba(255, 255, 255, 0.08)" },
  label: { fontFamily: font.regular, fontSize: 14, color: color.text },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17, color: color.muted },
});
