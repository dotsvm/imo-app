/**
 * Notifications: fills, results, replies and follows, newest first — the
 * unread ones under "New", the rest by day. Each opens where it's about;
 * some carry their own action (Claim). Filter by kind; mark everything read
 * in one go. Older pages load as you scroll.
 */
import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, router } from "expo-router";
import { type ComponentType, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IconProps } from "phosphor-react-native";
import { BellIcon } from "phosphor-react-native/src/icons/Bell";
import { ChartLineUpIcon } from "phosphor-react-native/src/icons/ChartLineUp";
import { ChatCircleTextIcon } from "phosphor-react-native/src/icons/ChatCircleText";
import { CheckCircleIcon } from "phosphor-react-native/src/icons/CheckCircle";
import { CircleDashedIcon } from "phosphor-react-native/src/icons/CircleDashed";
import { FlagIcon } from "phosphor-react-native/src/icons/Flag";
import { UserPlusIcon } from "phosphor-react-native/src/icons/UserPlus";
import { UsersIcon } from "phosphor-react-native/src/icons/Users";
import { XCircleIcon } from "phosphor-react-native/src/icons/XCircle";
import type { NotificationsPage } from "@imo/server/dto/api-types";
import { Button } from "~/components/button";
import { ChipTabs } from "~/components/chip-tabs";
import { ScreenHeader } from "~/components/screen-header";
import { Skeleton } from "~/components/skeleton";
import { Notice } from "~/features/home/notice";
import { api } from "~/lib/api";
import { ago } from "~/lib/format";
import { color, font } from "~/theme/tokens";

type Item = NotificationsPage["items"][number];
type Filter = "all" | "orders" | "wins" | "social";
const FILTERS: { id: Filter; label: string; kinds?: string[] }[] = [
  { id: "all", label: "All" },
  { id: "orders", label: "Orders", kinds: ["Order"] },
  { id: "wins", label: "Wins", kinds: ["Resolution"] },
  { id: "social", label: "Social", kinds: ["Reply", "Follow", "Room"] },
];

const ICONS: Record<string, { Icon: ComponentType<IconProps>; tint: string; lit?: boolean }> = {
  filled: { Icon: CheckCircleIcon, tint: color.pos, lit: true },
  resolved: { Icon: FlagIcon, tint: color.pos, lit: true },
  partial: { Icon: CircleDashedIcon, tint: color.gold },
  failed: { Icon: XCircleIcon, tint: color.neg },
  reply: { Icon: ChatCircleTextIcon, tint: color.text },
  follow: { Icon: UserPlusIcon, tint: color.text },
  room: { Icon: UsersIcon, tint: color.text },
  price: { Icon: ChartLineUpIcon, tint: color.text },
};

/** The list's own key; the top bar's unread dot reads ["notifications"] (page one). */
const LIST_KEY = ["notifications", "list"] as const;
const DAY = 86_400_000;

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

/** Which day-bucket a read notification falls in. */
function bucket(iso: string, now: number) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const t = new Date(iso).getTime();
  if (t >= start.getTime()) return "Earlier today";
  if (t >= start.getTime() - DAY) return "Yesterday";
  if (t >= start.getTime() - 6 * DAY) return "This week";
  return "Earlier";
}

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [now] = useState(() => Date.now());
  const list = useInfiniteQuery({
    queryKey: LIST_KEY,
    queryFn: ({ pageParam, signal }) => api<NotificationsPage>("/notifications", { query: { before: pageParam, limit: 30 }, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const unread = list.data?.pages[0]?.unread ?? 0;
  const kinds = FILTERS.find((f) => f.id === filter)!.kinds;
  const items = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((n) => !kinds || kinds.includes(n.kind));

  const sections: { title: string; data: Item[] }[] = [];
  const fresh = items.filter((n) => !n.read);
  if (fresh.length) sections.push({ title: "New", data: fresh });
  for (const n of items.filter((n) => n.read)) {
    const title = bucket(n.at, now);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(n);
    else sections.push({ title, data: [n] });
  }

  async function markRead(body: { ids: string[] } | { all: true }) {
    const read = (n: Item) => ("all" in body || body.ids.includes(n.id) ? { ...n, read: true } : n);
    const fewer = (u: number) => ("all" in body ? 0 : Math.max(0, u - body.ids.length));
    queryClient.setQueryData<InfiniteData<NotificationsPage>>(LIST_KEY, (d) =>
      d ? { ...d, pages: d.pages.map((p, i) => ({ ...p, unread: i === 0 ? fewer(p.unread) : p.unread, items: p.items.map(read) })) } : d,
    );
    // The top bar's dot.
    queryClient.setQueryData<NotificationsPage>(["notifications"], (d) => (d ? { ...d, unread: fewer(d.unread), items: d.items.map(read) } : d));
    await api("/notifications/read", { body }).catch(() => undefined);
  }

  function open(n: Item, href?: string | null) {
    if (!n.read) markRead({ ids: [n.id] });
    const route = toRoute(href ?? n.href);
    if (route) router.push(route);
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Notifications"
        right={
          unread ? (
            <Pressable onPress={() => markRead({ all: true })} hitSlop={8} accessibilityRole="button" style={styles.markAll}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </Pressable>
          ) : null
        }
      />
      <ChipTabs options={FILTERS} value={filter} onChange={setFilter} style={styles.filters} />

      {list.isPending ? (
        <View style={styles.loading} accessibilityLabel="Loading notifications" accessibilityRole="progressbar">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.rowMain}>
              <Skeleton width={40} height={40} style={{ borderRadius: 14 }} />
              <View style={{ flex: 1, gap: 6, paddingTop: 2 }}>
                <Skeleton width={140} height={13} />
                <Skeleton height={11} />
              </View>
            </View>
          ))}
        </View>
      ) : list.isError ? (
        <Notice title="Notifications didn't load" body={list.error.message} action={{ label: "Try again", onPress: () => list.refetch() }} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          refreshControl={<RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => list.refetch()} tintColor={color.neutral600} />}
          renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
          renderItem={({ item }) => <Row n={item} onOpen={open} />}
          onEndReachedThreshold={0.5}
          onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && list.fetchNextPage()}
          ListEmptyComponent={
            <Notice title="Nothing here" body={filter === "all" ? "Fills, results, replies and follows show up here." : "Nothing of this kind yet."} />
          }
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator color={color.neutral600} style={{ margin: 24 }} /> : null}
        />
      )}
    </View>
  );
}

function Row({ n, onOpen }: { n: Item; onOpen: (n: Item, href?: string | null) => void }) {
  const { Icon, tint, lit } = ICONS[n.icon] ?? { Icon: BellIcon, tint: color.text };
  const cta = "cta" in n ? (n.cta as { href: string; label: string; primary?: boolean } | undefined) : undefined;
  return (
    <Pressable
      onPress={() => onOpen(n)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${n.title}. ${n.body}${n.read ? "" : ". Unread"}`}
    >
      <View style={styles.rowMain}>
        <View style={[styles.icon, lit && styles.iconLit]}>
          <Icon size={17} weight="fill" color={tint} />
        </View>
        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={styles.rowTitle}>{n.title}</Text>
            <View style={styles.meta}>
              <Text style={styles.time}>{ago(n.at)}</Text>
              <View style={[styles.dot, n.read && styles.dotRead]} />
            </View>
          </View>
          <Text style={styles.rowBody}>{n.body}</Text>
          {cta && toRoute(cta.href) ? (
            <View style={styles.cta}>
              <Button
                size="xs"
                variant={cta.primary ? "primary" : "surface"}
                label={cta.label}
                onPress={() => onOpen(n, cta.href)}
                style={styles.ctaButton}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  markAll: { height: 40, justifyContent: "center", paddingHorizontal: 4 },
  markAllText: { fontFamily: font.regular, fontSize: 13, color: color.neutral800 },
  filters: { paddingBottom: 6 },
  loading: { paddingHorizontal: 20, paddingTop: 18, gap: 22 },
  section: { fontFamily: font.regular, fontSize: 12, color: color.muted, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  row: { paddingHorizontal: 20, paddingVertical: 10 },
  rowPressed: { backgroundColor: "rgba(255, 255, 255, 0.03)" },
  rowMain: { flexDirection: "row", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: color.card },
  iconLit: { backgroundColor: color.pos200 },
  content: { flex: 1, gap: 3, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  rowTitle: { flex: 1, fontFamily: font.medium, fontSize: 14, lineHeight: 19, color: color.text },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  time: { fontFamily: font.regular, fontSize: 11, color: color.muted, fontVariant: ["tabular-nums"] },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.pos },
  dotRead: { backgroundColor: "transparent" },
  rowBody: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.neutral800 },
  cta: { flexDirection: "row", marginTop: 6 },
  ctaButton: { paddingHorizontal: 13 },
});
