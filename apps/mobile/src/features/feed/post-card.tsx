/**
 * One take in the feed: who said it and their record, what they said, the
 * market with their disclosed position marked live, and Back to take the
 * same side. Prices follow the web: Back buys at the ask, a position is
 * worth the bid.
 */
import { router } from "expo-router";
import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DotsThreeIcon } from "phosphor-react-native/src/icons/DotsThree";
import { Avatar } from "~/components/avatar";
import { BackButton } from "~/components/back-button";
import { openTrader } from "~/lib/nav";
import { ago, arrowUsd, price } from "~/lib/format";
import { bestAsk, bestBid, type Outcome } from "~/lib/market";
import { color, font, radius, space, text } from "~/theme/tokens";
import { PostMenu } from "./post-menu";
import { Reactions } from "./reactions";
import type { FeedEntry } from "./use-feed";

interface Props extends FeedEntry {
  venueName?: string;
  /** "55% right · 421 resolved", when there's a record to show. */
  record: string | null;
  /** "Now" for relative times: the demo dataset's fixed moment, else the clock. */
  now?: number;
  onTrade: (entry: FeedEntry, outcome: Outcome) => void;
}

export const PostCard = memo(function PostCard({
  post,
  market,
  venueName,
  record,
  now,
  onTrade,
}: Props) {
  const [menu, setMenu] = useState(false);
  const venue = venueName ?? market.venueId;
  const ask = bestAsk(market, post.outcome);
  const disclosed = post.disclosePosition && post.evidenceShares > 0;
  // Open positions mark to the executable bid, as the portfolio does.
  const unrealized = disclosed
    ? (bestBid(market, post.outcome) - post.entryPrice) * post.evidenceShares
    : 0;
  const pnlColor =
    unrealized > 0 ? color.pos : unrealized < 0 ? color.neg : color.neutral700;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Pressable
          onPress={() => openTrader(post.author.handle, post.author.isYou)}
          style={styles.whoLink}
          accessibilityRole="link"
          accessibilityLabel={`${post.author.name}'s profile`}
        >
          <Avatar url={post.author.avatarUrl} size={40} />
          <View style={styles.who}>
            <Text style={styles.name} numberOfLines={1}>
              {post.author.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[ago(post.at, now), record].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => setMenu(true)}
          hitSlop={10}
          style={styles.more}
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${post.author.name.split(" ")[0]}’s prediction`}
        >
          <DotsThreeIcon size={20} weight="bold" color={color.neutral600} />
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push(`/post/${post.id}`)}
        style={({ pressed }) => [styles.open, pressed && styles.openPressed]}
        accessibilityRole="link"
        accessibilityHint="Opens the prediction and its discussion"
      >
        <Text style={styles.body}>{post.text}</Text>

        <View style={styles.market}>
          <View style={styles.marketText}>
            <Text style={styles.marketTitle} numberOfLines={2}>
              {market.shortTitle || market.title}
            </Text>
            <Text style={styles.marketMeta} numberOfLines={1}>
              {post.outcome} ·{" "}
              {disclosed
                ? `${post.evidenceShares.toLocaleString("en-US")} @ ${price(post.entryPrice)}`
                : post.disclosePosition
                  ? "No position"
                  : `${price(post.entryPrice)} when posted`}{" "}
              · {venue}
            </Text>
          </View>
          {disclosed ? (
            <View style={styles.marketFigure}>
              <Text style={[styles.pnl, { color: pnlColor }]}>
                {arrowUsd(unrealized)}
              </Text>
              <Text style={styles.marketMeta}>unrealized</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Reactions post={post} />
        <View style={styles.spacer} />
        {market.status === "open" ? (
          <BackButton
            outcome={post.outcome}
            price={price(ask)}
            onPress={() => onTrade({ post, market }, post.outcome)}
          />
        ) : null}
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

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[4],
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  whoLink: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  who: { flex: 1, gap: 3 },
  name: { fontFamily: font.medium, fontSize: 16, color: color.text },
  meta: {
    fontFamily: font.regular,
    fontSize: text.ui,
    color: color.neutral700,
    fontVariant: ["tabular-nums"],
  },
  more: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -6,
  },
  open: { gap: 14 },
  openPressed: { opacity: 0.7 },
  body: {
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 25,
    color: color.text,
  },
  market: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: 14,
    borderRadius: radius.card,
    backgroundColor: "#121714",
  },
  marketText: { flex: 1, gap: 5 },
  marketTitle: {
    fontFamily: font.medium,
    fontSize: text.post,
    color: color.text,
  },
  marketMeta: {
    fontFamily: font.regular,
    fontSize: text.ui,
    color: color.neutral700,
    fontVariant: ["tabular-nums"],
  },
  marketFigure: { alignItems: "flex-end", gap: 5 },
  pnl: {
    fontFamily: font.medium,
    fontSize: text.post,
    fontVariant: ["tabular-nums"],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    minHeight: 44,
  },
  spacer: { flex: 1 },
});
