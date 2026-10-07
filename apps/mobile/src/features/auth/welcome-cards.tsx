/**
 * The welcome screen's fanned stack: three real calls from the feed, tilted
 * like cards on a table, the front one brightest. Authors' "% right" comes
 * from the leaderboard when they have enough resolved calls to count.
 * Nothing is drawn until real posts arrive; no stand-ins.
 */
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { ArrowsLeftRightIcon } from "phosphor-react-native/src/icons/ArrowsLeftRight";
import { HeartIcon } from "phosphor-react-native/src/icons/Heart";
import type { LeaderboardDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Rise } from "~/components/rise";
import { type FeedEntry, useFeed } from "~/features/feed/use-feed";
import { api } from "~/lib/api";
import { count, price } from "~/lib/format";
import { bestAsk } from "~/lib/market";
import { color, font, radius, space } from "~/theme/tokens";

// Back to front: how high each card sits above the stage's floor, and how
// far it leans. Anchored to the floor, a short screen trims the back cards'
// tops, never the headline below.
const PLACES = [
  { bottom: 172, left: 46, rotate: "4deg", dim: 0.4 },
  { bottom: 90, left: 0, rotate: "-5deg", dim: 0.55 },
  { bottom: 10, left: 24, rotate: "-1.5deg", dim: 1 },
] as const;

export function WelcomeCards() {
  const feed = useFeed("for-you");
  const board = useQuery({
    queryKey: ["welcome", "board"],
    queryFn: ({ signal }) =>
      api<LeaderboardDTO>("/leaderboard", { query: { period: "All", sample: "on", limit: 100 }, signal }),
    staleTime: 5 * 60 * 1000,
  });
  const right = new Map(
    (board.data?.items ?? []).map((r) => [
      r.trader.id,
      r.stats.resolved ? Math.round((r.stats.correct / r.stats.resolved) * 100) : null,
    ]),
  );
  const entries = (feed.data?.pages[0]?.entries ?? []).slice(0, PLACES.length);
  if (entries.length < PLACES.length) return <View style={styles.stage} />;


  return (
    <View style={styles.stage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {entries.map((entry, i) => {
        const place = PLACES[i]!;
        return (
          <View
            key={entry.post.id}
            style={[styles.place, { bottom: place.bottom, left: place.left, transform: [{ rotate: place.rotate }] }]}
          >
            <Rise delay={80 * i} duration={420}>
              <Card entry={entry} right={right.get(entry.post.authorId) ?? null} dim={place.dim} />
            </Rise>
          </View>
        );
      })}
      {/* Cards running off the top fade out rather than ending on a hard edge. */}
      <View style={styles.fade} />
    </View>
  );
}

function Card({ entry: { post, market }, right, dim }: { entry: FeedEntry; right: number | null; dim: number }) {
  const yes = post.outcome === "Yes";
  return (
    // The card stays solid so nothing behind shows through; only what's on it dims.
    <View style={[styles.card, dim < 1 && styles.cardBack]}>
      <View style={[styles.content, { opacity: dim }]}>
        <View style={styles.head}>
          <Avatar url={post.author.avatarUrl} size={28} />
          <Text style={styles.name} numberOfLines={1}>
            {post.author.name}
          </Text>
          {right !== null ? <Text style={styles.right}>{right}% right</Text> : null}
        </View>
        <Text style={styles.text} numberOfLines={2}>
          {post.text}
        </Text>
        <View style={styles.foot}>
          <View style={[styles.side, { backgroundColor: yes ? color.pos200 : color.neg200 }]}>
            <Text style={[styles.sideText, { color: yes ? color.pos : color.neg }]}>
              {post.outcome} · {price(bestAsk(market, post.outcome))}
            </Text>
          </View>
          <View style={styles.stats}>
            <HeartIcon size={13} color={color.neutral600} />
            <Text style={styles.stat}>{count(post.likes)}</Text>
            <ArrowsLeftRightIcon size={13} color={color.neutral600} />
            <Text style={styles.stat}>{count(post.reposts)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Takes all the room the headline and buttons leave; the stack sits on its floor.
  stage: { flex: 1, minHeight: 140, overflow: "hidden", marginBottom: space[4] },
  fade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 48,
    pointerEvents: "none",
    experimental_backgroundImage: `linear-gradient(180deg, ${color.bg}, rgba(9, 13, 11, 0))`,
  },
  place: { position: "absolute", width: "86%" },
  card: {
    paddingHorizontal: space[4],
    paddingVertical: 14,
    borderRadius: radius.sheet,
    backgroundColor: "#111614",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#222b26",
    boxShadow: "0 18px 40px -12px rgba(0, 0, 0, 0.7)",
  },
  content: { gap: 9 },
  cardBack: { backgroundColor: "#0e1311", borderColor: "#1b231f" },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontFamily: font.medium, fontSize: 14, color: color.neutral800 },
  right: { fontFamily: font.regular, fontSize: 11, color: color.neutral600 },
  text: { fontFamily: font.regular, fontSize: 15, lineHeight: 21, color: color.text },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  side: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  sideText: { fontFamily: font.semibold, fontSize: 12, fontVariant: ["tabular-nums"] },
  stats: { flexDirection: "row", alignItems: "center", gap: 4 },
  stat: { fontFamily: font.regular, fontSize: 12, color: color.neutral600, marginRight: 8 },
});
