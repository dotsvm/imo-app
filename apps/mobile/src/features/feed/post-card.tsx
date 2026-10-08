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
import { openTrader } from "~/lib/nav";
import { ago, arrowUsd, count, price } from "~/lib/format";
import { bestAsk, bestBid, type Outcome } from "~/lib/market";
import { color, font, radius, space, text } from "~/theme/tokens";
import { PostMenu } from "./post-menu";
import { Reactions } from "./reactions";
import type { FeedEntry } from "./use-feed";

interface Props extends FeedEntry {
  /** "Now" for relative times: the demo dataset's fixed moment, else the clock. */
  now?: number;
  onTrade: (entry: FeedEntry, outcome: Outcome) => void;
}

export const PostCard = memo(function PostCard({ post, market, now, onTrade }: Props) {
  const [menu, setMenu] = useState(false);
  const ask = bestAsk(market, post.outcome);
  const bid = bestBid(market, post.outcome);
  const disclosed = post.disclosePosition && post.evidenceShares > 0;
  // Open positions mark to the executable bid, as the portfolio does.
  const unrealized = disclosed ? (bid - post.entryPrice) * post.evidenceShares : 0;
  const pnlColor = unrealized > 0 ? color.pos : unrealized < 0 ? color.neg : color.neutral700;
  const open = () => openTrader(post.author.handle, post.author.isYou);

  return (
    <View style={styles.card}>
      <Pressable onPress={open} accessibilityRole="link" accessibilityLabel={`${post.author.name}'s profile`}>
        <Avatar url={post.author.avatarUrl} size={44} />
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
            <DotsThreeIcon size={20} weight="bold" color={color.neutral600} />
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
                    <View key={b.handle} style={[styles.stackItem, i > 0 && { marginLeft: -8 }]}>
                      <Avatar url={b.avatarUrl ?? ""} size={22} />
                    </View>
                  ))}
                </View>
              ) : null}
              <Text style={styles.backedText}>{count(post.backed)} backed this call</Text>
            </View>
          ) : null}

          <View style={styles.market}>
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
          {market.status === "open" ? (
            <BackButton outcome={post.outcome} price={price(ask)} onPress={() => onTrade({ post, market }, post.outcome)} />
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

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  main: { flex: 1, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: space[2], marginTop: 2 },
  who: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6, minWidth: 0 },
  name: { fontFamily: font.semibold, fontSize: 16, color: color.text, flexShrink: 1 },
  handle: { fontFamily: font.regular, fontSize: 15, color: color.neutral700, flexShrink: 2, fontVariant: ["tabular-nums"] },
  more: { width: 28, height: 24, alignItems: "flex-end", justifyContent: "center" },
  open: { gap: 12 },
  openPressed: { opacity: 0.7 },
  body: { fontFamily: font.regular, fontSize: 17, lineHeight: 25, color: color.text },
  backers: { flexDirection: "row", alignItems: "center", gap: 8 },
  stack: { flexDirection: "row" },
  stackItem: { borderRadius: 13, borderWidth: 2, borderColor: color.bg },
  backedText: { fontFamily: font.regular, fontSize: 14, color: color.neutral700, fontVariant: ["tabular-nums"] },
  market: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: 13,
    borderRadius: radius.panel,
    backgroundColor: "#111513",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
  },
  marketText: { flex: 1, gap: 4 },
  marketTitle: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  marketMeta: { fontFamily: font.regular, fontSize: 13, color: color.neutral700, fontVariant: ["tabular-nums"] },
  marketFigure: { alignItems: "flex-end", gap: 4 },
  pnl: { fontFamily: font.semibold, fontSize: text.post, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", alignItems: "center", gap: space[4], minHeight: 48 },
  spacer: { flex: 1 },
});
