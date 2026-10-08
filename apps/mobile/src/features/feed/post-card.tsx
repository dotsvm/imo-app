/**
 * One call in the feed: who made it, what they said, who backed it, and the
 * market with their disclosed position marked live ("now" is the bid it
 * would sell at); then Back to take the same side. Fade lives in the ⋯ menu.
 * Prices follow the web: Back buys at the ask, a position is worth the bid.
 */
import { router } from "expo-router";
import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DotsThreeIcon } from "phosphor-react-native/src/icons/DotsThree";
import { Avatar } from "~/components/avatar";
import { BackButton } from "~/components/back-button";
import { VenueMark } from "~/components/venue-mark";
import { openTrader } from "~/lib/nav";
import { ago, arrowUsd, count, price } from "~/lib/format";
import { bestAsk, bestBid, type Outcome } from "~/lib/market";
import { color, font, space } from "~/theme/tokens";
import { PostMenu } from "./post-menu";
import { Reactions } from "./reactions";
import type { FeedEntry } from "./use-feed";
import { useCanTrade } from "~/features/trade/use-tradable";

interface Props extends FeedEntry {
  /** "Now" for relative times: the demo dataset's fixed moment, else the clock. */
  now?: number;
  onTrade: (entry: FeedEntry, outcome: Outcome) => void;
}

export const PostCard = memo(function PostCard({ post, market, now, onTrade }: Props) {
  const canTrade = useCanTrade();
  const [menu, setMenu] = useState(false);
  const ask = bestAsk(market, post.outcome);
  const bid = bestBid(market, post.outcome);
  const disclosed = post.disclosePosition && post.evidenceShares > 0;
  // Open positions mark to the executable bid, as the portfolio does.
  const unrealized = disclosed ? (bid - post.entryPrice) * post.evidenceShares : 0;
  const pnlColor = unrealized > 0 ? color.gain : unrealized < 0 ? color.neg : color.neutral700;
  const open = () => openTrader(post.author.handle, post.author.isYou);

  return (
    <View style={styles.card}>
      <Pressable onPress={open} accessibilityRole="link" accessibilityLabel={`${post.author.name}'s profile`}>
        <Avatar url={post.author.avatarUrl} size={40} />
      </Pressable>

      <View style={styles.main}>
        <View style={styles.head}>
          <Pressable onPress={open} style={styles.who} accessibilityRole="link">
            <Text style={styles.name} numberOfLines={1}>
              {post.author.name}
            </Text>
            <Text style={styles.handle} numberOfLines={1}>
              @{post.author.handle} · {ago(post.at, now)}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMenu(true)}
            hitSlop={10}
            style={styles.more}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${post.author.name.split(" ")[0]}’s call`}
          >
            <DotsThreeIcon size={16} weight="bold" color={color.neutral700} />
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push(`/post/${post.id}`)}
          style={({ pressed }) => [styles.open, pressed && styles.openPressed]}
          accessibilityRole="link"
          accessibilityHint="Opens the call and its discussion"
        >
          <Text style={styles.body}>{post.text}</Text>

          {post.backed > 0 ? (
            <View style={styles.backers}>
              {post.backers.length ? (
                <View style={styles.stack} accessibilityElementsHidden>
                  {post.backers.map((b, i) => (
                    <View key={b.handle} style={[styles.stackItem, i > 0 && { marginLeft: -5 }]}>
                      <Avatar url={b.avatarUrl ?? ""} size={18} />
                    </View>
                  ))}
                </View>
              ) : null}
              <Text style={styles.backedText}>{count(post.backed)} backed this call</Text>
            </View>
          ) : null}

          <View style={styles.market}>
            <View style={styles.tile}>
              <VenueMark venueId={market.venueId} tile size={32} />
              <View style={styles.tileRing} />
            </View>
            <View style={styles.marketText}>
              <Text style={styles.marketTitle} numberOfLines={2}>
                {market.shortTitle || market.title}
              </Text>
              <Text style={styles.marketMeta} numberOfLines={1}>
                {post.outcome} ·{" "}
                {disclosed ? `${post.evidenceShares.toLocaleString("en-US")} @ ${price(post.entryPrice)}` : `${price(post.entryPrice)} when called`}
                {market.status === "open" ? ` · now ${price(bid)}` : ""}
              </Text>
            </View>
            {disclosed ? (
              <View style={styles.marketFigure}>
                <Text style={[styles.pnl, { color: pnlColor }]}>{arrowUsd(unrealized)}</Text>
                <Text style={styles.marketMeta}>unrealized</Text>
              </View>
            ) : null}
          </View>
        </Pressable>

        <View style={styles.actions}>
          <Reactions post={post} showSave={false} />
          <View style={styles.spacer} />
          {canTrade(market) ? (
            <BackButton size="sm" outcome={post.outcome} price={price(ask)} onPress={() => onTrade({ post, market }, post.outcome)} />
          ) : null}
        </View>
      </View>

      <PostMenu
        post={post}
        market={market}
        open={menu}
        onClose={() => setMenu(false)}
        onTrade={(outcome) => onTrade({ post, market }, outcome)}
      />
    </View>
  );
});

const HAIRLINE = "rgba(255, 255, 255, 0.08)";

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: space[4],
    paddingTop: 14,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  main: { flex: 1, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 5 },
  who: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 5, minWidth: 0 },
  name: { fontFamily: font.semibold, fontSize: 14, color: color.text, flexShrink: 1 },
  handle: { fontFamily: font.regular, fontSize: 14, color: color.neutral700, flexShrink: 2, fontVariant: ["tabular-nums"] },
  more: { width: 28, height: 20, alignItems: "flex-end", justifyContent: "center" },
  open: { gap: 6 },
  openPressed: { opacity: 0.7 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 21, color: color.text },
  backers: { flexDirection: "row", alignItems: "center", gap: 6 },
  stack: { flexDirection: "row" },
  stackItem: { borderRadius: 11, borderWidth: 2, borderColor: color.bg },
  backedText: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, fontVariant: ["tabular-nums"] },
  market: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "#121815",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.06)",
  },
  // Logos sit on the box's own color, so round ones (Jupiter) read as clean circles.
  tile: { width: 32, height: 32, borderRadius: 10, overflow: "hidden", backgroundColor: "#121815" },
  tileRing: { ...StyleSheet.absoluteFill, borderRadius: 10, borderWidth: 1, borderColor: HAIRLINE },
  marketText: { flex: 1, gap: 2 },
  marketTitle: { fontFamily: font.medium, fontSize: 13, lineHeight: 17, color: color.text },
  marketMeta: { fontFamily: font.regular, fontSize: 11, color: color.neutral700, fontVariant: ["tabular-nums"] },
  marketFigure: { alignItems: "flex-end", gap: 2 },
  pnl: { fontFamily: font.semibold, fontSize: 13, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, marginTop: 2 },
  spacer: { flex: 1 },
});
