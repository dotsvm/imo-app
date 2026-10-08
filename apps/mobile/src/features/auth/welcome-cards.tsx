/**
 * The welcome screen's fanned stack: three real calls from the feed, tilted
 * like cards on a table, the front one brightest, dissolving into the
 * headline below. Authors' "% right" comes from the leaderboard when they
 * have enough resolved calls to count. Nothing is drawn until real posts
 * arrive; no stand-ins.
 */
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { ArrowsLeftRightIcon } from "phosphor-react-native/src/icons/ArrowsLeftRight";
import { HeartIcon } from "phosphor-react-native/src/icons/Heart";
import type { LeaderboardDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Rise } from "~/components/rise";
import { type FeedEntry, useFeed } from "~/features/feed/use-feed";
import { api } from "~/lib/api";
import { count, price } from "~/lib/format";
import { bestAsk } from "~/lib/market";
import { color, font } from "~/theme/tokens";

// Back to front: how high each card sits above the stage's floor, how far
// in from the left (of the 342pt-wide stage in the design), how far it
// leans and how bright it is. Anchored to the floor, a short screen trims
// the back cards' tops, never the headline below.
const PLACES = [
  { bottom: 188, left: 0.2, rotate: "6deg", dim: 0.55 },
  { bottom: 100, left: 0, rotate: "-5deg", dim: 0.8 },
  { bottom: 12, left: 0.135, rotate: "2deg", dim: 1 },
] as const;
// The screen's side gutters (24 each).
const GUTTERS = 48;

export function WelcomeCards() {
  const { width } = useWindowDimensions();
  const stage = width - GUTTERS;
  const cardWidth = Math.min(276, 0.72 * width);
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
            style={[
              styles.place,
              {
                width: cardWidth,
                bottom: place.bottom,
                left: Math.min(place.left * stage, stage - cardWidth),
                transform: [{ rotate: place.rotate }],
              },
            ]}
          >
            <Rise delay={80 * i} duration={420}>
              <Card entry={entry} right={right.get(entry.post.authorId) ?? null} dim={place.dim} />
            </Rise>
          </View>
        );
      })}
      {/* Cards running off the top fade out rather than ending on a hard edge… */}
      <View style={styles.fadeTop} />
      {/* …and the stack dissolves into the headline below. */}
      <View style={styles.fadeBottom} />
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
          <Avatar url={post.author.avatarUrl} size={26} />
          <Text style={styles.name} numberOfLines={1}>
            {post.author.name}
          </Text>
          {right !== null ? <Text style={styles.right}>{right}% right</Text> : null}
        </View>
        <Text style={styles.text} numberOfLines={2}>
          {post.text}
        </Text>
        <View style={styles.foot}>
          <View style={[styles.side, { backgroundColor: yes ? "#b5e6a122" : "#ec8b7822" }]}>
            <Text style={[styles.sideText, { color: yes ? color.pos : color.neg }]}>
              {post.outcome} · {price(bestAsk(market, post.outcome))}
            </Text>
          </View>
          <View style={styles.stats}>
            <View style={styles.statPair}>
              <HeartIcon size={12} weight="bold" color={color.muted} />
              <Text style={styles.stat}>{count(post.likes)}</Text>
            </View>
            <View style={styles.statPair}>
              <ArrowsLeftRightIcon size={12} weight="bold" color={color.muted} />
              <Text style={styles.stat}>{count(post.reposts)}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Takes all the room the headline and buttons leave; the stack sits on its floor.
  stage: { flex: 1, minHeight: 140, overflow: "hidden", marginBottom: 12 },
  fadeTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 48,
    pointerEvents: "none",
    experimental_backgroundImage: `linear-gradient(180deg, ${color.bg}, rgba(9, 13, 11, 0))`,
  },
  fadeBottom: {
    ...StyleSheet.absoluteFill,
    pointerEvents: "none",
    experimental_backgroundImage: "linear-gradient(180deg, rgba(9, 13, 11, 0) 62%, rgba(9, 13, 11, 0.92) 100%)",
  },
  place: { position: "absolute" },
  card: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 22,
    backgroundColor: "#121815",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.07)",
    boxShadow: "0 24px 50px -16px rgba(0, 0, 0, 0.8)",
  },
  cardBack: { backgroundColor: "#0f1412" },
  content: { gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontFamily: font.medium, fontSize: 13, color: color.text },
  right: { fontFamily: font.regular, fontSize: 11, color: color.muted },
  text: { fontFamily: font.medium, fontSize: 15, lineHeight: 20, letterSpacing: -0.15, color: color.text },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  side: { height: 26, paddingHorizontal: 10, borderRadius: 999, justifyContent: "center" },
  sideText: { fontFamily: font.semibold, fontSize: 12, fontVariant: ["tabular-nums"] },
  stats: { flexDirection: "row", alignItems: "center", gap: 12 },
  statPair: { flexDirection: "row", alignItems: "center", gap: 4 },
  stat: { fontFamily: font.regular, fontSize: 12, color: color.muted, fontVariant: ["tabular-nums"] },
});
