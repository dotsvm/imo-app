/**
 * The Home header: the imo mark and name, a DEMO tag on demo servers, then
 * search and notifications.
 */
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BellIcon } from "phosphor-react-native/src/icons/Bell";
import { MagnifyingGlassIcon } from "phosphor-react-native/src/icons/MagnifyingGlass";
import type { NotificationsPage } from "@imo/server/dto/api-types";
import { useConfig } from "~/features/auth/auth";
import { api } from "~/lib/api";
import { color, font, radius, space } from "~/theme/tokens";
import { PressableScale } from "./pressable-scale";

interface Props {
  /** The page's name beside the mark; "imo" on Home. */
  title?: string;
  /** Hidden where the page has its own search bar. */
  showSearch?: boolean;
  /** One more tool before the bell (Discover's watchlists). */
  extra?: { label: string; icon: ReactNode; onPress: () => void };
  onSearch?: () => void;
  onNotifications?: () => void;
}

export function TopBar({ title = "imo", showSearch = true, extra, onSearch, onNotifications }: Props) {
  const insets = useSafeAreaInsets();
  const demo = useConfig().data?.profile === "demo";
  // Shares the Notifications screen's query: the dot clears as soon as they're read there.
  const unread = useQuery({
    queryKey: ["notifications"],
    queryFn: ({ signal }) => api<NotificationsPage>("/notifications", { signal }),
    staleTime: 60_000,
  }).data?.unread;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space[2] }]}>
      <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel={title}>
        <Image source={require("~/assets/brand/mark.png")} style={styles.mark} contentFit="contain" />
        <Text style={styles.name}>{title}</Text>
      </View>
      <View style={styles.tools}>
        {demo ? (
          <View style={styles.demo} accessible accessibilityLabel="Demo server">
            <Text style={styles.demoText}>DEMO</Text>
          </View>
        ) : null}
        {showSearch ? (
          <IconButton label="Search" onPress={onSearch}>
            <MagnifyingGlassIcon size={23} weight="bold" color={color.text} />
          </IconButton>
        ) : null}
        {extra ? (
          <IconButton label={extra.label} onPress={extra.onPress}>
            {extra.icon}
          </IconButton>
        ) : null}
        <IconButton
          label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          onPress={onNotifications ?? (() => router.push("/notifications"))}
        >
          <BellIcon size={23} weight="fill" color={color.text} />
          {unread ? <View style={styles.unread} /> : null}
        </IconButton>
      </View>
    </View>
  );
}

function IconButton({ label, onPress, children }: { label: string; onPress?: () => void; children: ReactNode }) {
  return (
    <PressableScale
      onPress={onPress}
      style={styles.icon}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
    >
      {children}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    backgroundColor: color.bg,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  mark: { width: 26, height: 26 },
  name: { fontFamily: font.medium, fontSize: 24, letterSpacing: -0.5, color: color.text },
  tools: { flexDirection: "row", alignItems: "center", gap: space[2] },
  demo: {
    height: 26,
    paddingHorizontal: 10,
    marginRight: space[1],
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: color.gold200,
  },
  demoText: { fontFamily: font.medium, fontSize: 12, letterSpacing: 0.6, color: color.gold },
  unread: {
    position: "absolute",
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#7fd47a",
    borderWidth: 1.5,
    borderColor: color.bg,
  },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
