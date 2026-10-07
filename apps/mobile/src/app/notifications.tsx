/**
 * Notifications: fills, results, replies and follows, newest first, the
 * unread ones up top. Each opens where it's about; some carry their own
 * action (Claim). Filter by kind; mark everything read in one go.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, router } from "expo-router";
import { type ComponentType, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IconProps } from "phosphor-react-native";
import { BellIcon } from "phosphor-react-native/src/icons/Bell";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { ChartLineUpIcon } from "phosphor-react-native/src/icons/ChartLineUp";
import { ChatCircleIcon } from "phosphor-react-native/src/icons/ChatCircle";
import { CheckCircleIcon } from "phosphor-react-native/src/icons/CheckCircle";
import { CircleHalfIcon } from "phosphor-react-native/src/icons/CircleHalf";
import { FlagIcon } from "phosphor-react-native/src/icons/Flag";
import { UserPlusIcon } from "phosphor-react-native/src/icons/UserPlus";
import { UsersThreeIcon } from "phosphor-react-native/src/icons/UsersThree";
import { WarningCircleIcon } from "phosphor-react-native/src/icons/WarningCircle";
import type { NotificationsPage } from "@imo/server/dto/api-types";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { Notice } from "~/features/home/notice";
import { api } from "~/lib/api";
import { ago } from "~/lib/format";
import { color, font, radius, space, text } from "~/theme/tokens";

type Item = NotificationsPage["items"][number];
type Filter = "all" | "orders" | "wins" | "social";
const FILTERS: { id: Filter; label: string; kinds?: string[] }[] = [
  { id: "all", label: "All" },
  { id: "orders", label: "Orders", kinds: ["Order"] },
  { id: "wins", label: "Wins", kinds: ["Resolution"] },
  { id: "social", label: "Social", kinds: ["Reply", "Follow", "Room", "Mention"] },
];

const ICONS: Record<string, { Icon: ComponentType<IconProps>; tint: string }> = {
  filled: { Icon: CheckCircleIcon, tint: color.pos },
  partial: { Icon: CircleHalfIcon, tint: color.gold },
  failed: { Icon: WarningCircleIcon, tint: color.neg },
  resolved: { Icon: FlagIcon, tint: color.pos },
  reply: { Icon: ChatCircleIcon, tint: color.neutral800 },
  follow: { Icon: UserPlusIcon, tint: color.neutral800 },
  room: { Icon: UsersThreeIcon, tint: color.neutral800 },
  price: { Icon: ChartLineUpIcon, tint: color.neutral800 },
};

/** The web's paths, as this app's screens. */
function toRoute(href: string | undefined | null): Href | null {
  if (!href) return null;
  const [path] = href.split("?");
  const parts = path!.split("/").filter(Boolean);
  if (parts[0] === "portfolio") return "/portfolio";
  if (parts[0] === "post" && parts[1]) return `/post/${parts[1]}`;
  if (parts[0] === "market" && parts[1]) return `/market/${parts[1]}`;
  if (parts[0] === "position" && parts[1]) return `/position/${parts[1]}`;
  if (parts[0] === "rooms" && parts[1]) return `/room/${parts[1]}`;
  if (parts[0] === "trader" && parts[1]) return { pathname: "/trader/[handle]", params: { handle: parts[1] } };
  return null;
}

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const list = useQuery({ queryKey: ["notifications"], queryFn: ({ signal }) => api<NotificationsPage>("/notifications", { signal }) });
  const kinds = FILTERS.find((f) => f.id === filter)!.kinds;
  const items = (list.data?.items ?? []).filter((n) => !kinds || kinds.includes(n.kind));
  const fresh = items.filter((n) => !n.read);
  const earlier = items.filter((n) => n.read);

  async function markRead(body: { ids: string[] } | { all: true }) {
    queryClient.setQueryData<NotificationsPage>(["notifications"], (d) =>
      d
        ? {
            ...d,
            unread: "all" in body ? 0 : Math.max(0, d.unread - body.ids.length),
            items: d.items.map((n) => ("all" in body || body.ids.includes(n.id) ? { ...n, read: true } : n)),
          }
        : d,
    );
    await api("/notifications/read", { body }).catch(() => undefined);
  }

  function open(n: Item, href?: string | null) {
    if (!n.read) markRead({ ids: [n.id] });
    const route = toRoute(href ?? n.href);
    if (route) router.push(route);
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space[1] }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <CaretLeftIcon size={22} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        {list.data?.unread ? (
          <Pressable onPress={() => markRead({ all: true })} hitSlop={8} accessibilityRole="button">
            <Text style={styles.markAll}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            onPress={() => setFilter(f.id)}
            style={[styles.filter, filter === f.id && styles.filterOn]}
            accessibilityRole="tab"
            accessibilityLabel={f.label}
            accessibilityState={{ selected: filter === f.id }}
          >
            <Text style={[styles.filterText, filter === f.id && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} tintColor={color.neutral600} />}
      >
        {list.isPending ? (
          <View style={{ padding: space[4], gap: space[5] }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ flexDirection: "row", gap: space[3] }}>
                <Skeleton width={36} height={36} style={{ borderRadius: 10 }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton width={140} height={13} />
                  <Skeleton height={11} />
                </View>
              </View>
            ))}
          </View>
        ) : list.isError ? (
          <Notice title="Notifications didn't load" body={list.error.message} action={{ label: "Try again", onPress: () => list.refetch() }} />
        ) : !items.length ? (
          <Notice title="Nothing here" body={filter === "all" ? "Fills, results, replies and follows show up here." : "Nothing of this kind yet."} />
        ) : (
          <>
            {fresh.length ? <Text style={styles.section}>New</Text> : null}
            {fresh.map((n) => (
              <Row key={n.id} n={n} onOpen={open} />
            ))}
            {earlier.length ? <Text style={styles.section}>Earlier</Text> : null}
            {earlier.map((n) => (
              <Row key={n.id} n={n} onOpen={open} />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ n, onOpen }: { n: Item; onOpen: (n: Item, href?: string | null) => void }) {
  const { Icon, tint } = ICONS[n.icon] ?? { Icon: BellIcon, tint: color.neutral800 };
  const cta = "cta" in n ? (n.cta as { href: string; label: string; primary?: boolean } | undefined) : undefined;
  return (
    <View style={styles.row}>
      <Pressable onPress={() => onOpen(n)} style={styles.rowMain} accessibilityRole="button" accessibilityLabel={`${n.title}. ${n.body}${n.read ? "" : ". Unread"}`}>
        <View style={styles.icon}>
          <Icon size={18} weight="fill" color={tint} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.rowTitle}>{n.title}</Text>
          <Text style={styles.rowBody}>{n.body}</Text>
        </View>
        <View style={styles.meta}>
          <Text style={styles.time}>{ago(n.at)}</Text>
          {!n.read ? <View style={styles.dot} /> : null}
        </View>
      </Pressable>
      {cta && toRoute(cta.href) ? (
        <View style={styles.cta}>
          <Button size="sm" variant={cta.primary ? "primary" : "outline"} label={cta.label} onPress={() => onOpen(n, cta.href)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3] },
  back: { width: 32, height: 36, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontFamily: font.medium, fontSize: 26, letterSpacing: -0.7, color: color.text },
  markAll: { fontFamily: font.regular, fontSize: text.ui, color: color.neutral800 },
  filters: { flexDirection: "row", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[3] },
  filter: { height: 32, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.neutral200 },
  filterOn: { backgroundColor: "#eceadf" },
  filterText: { fontFamily: font.medium, fontSize: text.ui, color: color.neutral800 },
  filterTextOn: { color: "#0b0d0c" },
  section: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[1] },
  row: { paddingHorizontal: space[4], paddingVertical: 10 },
  rowMain: { flexDirection: "row", gap: space[3] },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: color.neutral200 },
  rowTitle: { fontFamily: font.medium, fontSize: text.body, color: color.text },
  rowBody: { fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: color.neutral800 },
  meta: { alignItems: "flex-end", gap: 6, minWidth: 30 },
  time: { fontFamily: font.regular, fontSize: 11, color: color.neutral600 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#7fd47a" },
  cta: { flexDirection: "row", paddingLeft: 36 + space[3], marginTop: space[2] },
});
