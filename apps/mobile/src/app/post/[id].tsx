/**
 * One prediction in full: the author and their record, the call and how
 * sure they are, the market with their position marked live, the
 * discussion (each voice with what they hold), and a bar to reply, Back or Fade.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowUpIcon } from "phosphor-react-native/src/icons/ArrowUp";
import { BookmarkSimpleIcon } from "phosphor-react-native/src/icons/BookmarkSimple";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { ChatCircleIcon } from "phosphor-react-native/src/icons/ChatCircle";
import type { CommentDTO, MarketPage, PostDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { BackButton, FadeButton } from "~/components/back-button";
import { Button } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { useConfig } from "~/features/auth/auth";
import { setFollowing } from "~/features/auth/onboarding";
import { recordLine, useRecords } from "~/features/feed/use-records";
import { Notice } from "~/features/home/notice";
import { Reactions } from "~/features/feed/reactions";
import { TradeSheet } from "~/features/trade/trade-sheet";
import { api } from "~/lib/api";
import { openTrader } from "~/lib/nav";
import { ago, arrowUsd, price } from "~/lib/format";
import { bestAsk, bestBid, opposite, type Outcome } from "~/lib/market";
import { color, font, radius, space, text } from "~/theme/tokens";
import { useCanTrade } from "~/features/trade/use-tradable";

export default function PostDetail() {
  const { id, reply: wantsReply } = useLocalSearchParams<{
    id: string;
    reply?: string;
  }>();
  const replyBox = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const canTrade = useCanTrade();
  const queryClient = useQueryClient();
  const records = useRecords();
  const snapshot = useConfig().data?.dataSnapshot;
  const now = snapshot ? Date.parse(snapshot) : undefined;

  const post = useQuery({
    queryKey: ["post", id],
    queryFn: ({ signal }) => api<PostDTO>(`/posts/${id}`, { signal }),
  });
  const market = useQuery({
    queryKey: ["market", post.data?.marketId],
    queryFn: ({ signal }) =>
      api<MarketPage>("/markets", {
        query: { ids: post.data!.marketId, limit: 1 },
        signal,
      }).then((p) => p.items[0] ?? null),
    enabled: !!post.data,
  });
  const comments = useQuery({
    queryKey: ["comments", id],
    queryFn: ({ signal }) =>
      api<{ items: CommentDTO[] }>(`/posts/${id}/comments`, { signal }),
  });

  const [following, setFollowingState] = useState<boolean | null>(null);
  const [bookmarked, setBookmarked] = useState<boolean | null>(null);
  const [trade, setTrade] = useState<Outcome | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const p = post.data;
  const m = market.data;
  const isFollowing = following ?? p?.author.viewer?.following ?? false;
  const isSaved = bookmarked ?? p?.viewer?.bookmarked ?? false;

  async function toggleFollow() {
    if (!p) return;
    setFollowingState(!isFollowing);
    try {
      await setFollowing(p.author.handle, !isFollowing);
    } catch {
      setFollowingState(isFollowing);
    }
  }

  async function toggleSave() {
    if (!p) return;
    setBookmarked(!isSaved);
    try {
      await api(`/posts/${p.id}/reactions/bookmark`, {
        method: isSaved ? "DELETE" : "PUT",
      });
    } catch {
      setBookmarked(isSaved);
    }
  }

  async function send() {
    const body = reply.trim();
    if (!body || !p) return;
    setSending(true);
    setProblem(null);
    try {
      await api(`/posts/${p.id}/comments`, {
        body: {
          text: body,
          clientId: `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        },
      });
      setReply("");
      await queryClient.invalidateQueries({ queryKey: ["comments", id] });
      queryClient.invalidateQueries({ queryKey: ["post", id] });
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Your reply didn't post. Try again.",
      );
    } finally {
      setSending(false);
    }
  }

  const header = (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.headerIcon}
      >
        <CaretLeftIcon size={20} weight="bold" color={color.text} />
      </Pressable>
      <Text style={styles.headerTitle}>Prediction</Text>
      <View style={styles.spacer} />
      {p ? (
        <Pressable
          onPress={toggleSave}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={isSaved ? "Remove bookmark" : "Bookmark"}
          style={styles.headerIcon}
        >
          <BookmarkSimpleIcon
            size={18}
            weight="fill"
            color={isSaved ? color.pos : color.text}
          />
        </Pressable>
      ) : null}
    </View>
  );

  if (post.isError)
    return (
      <View style={styles.screen}>
        {header}
        <Notice
          title="This prediction didn't load"
          body={post.error.message}
          action={{ label: "Try again", onPress: () => post.refetch() }}
        />
      </View>
    );

  if (!p || market.isPending)
    return (
      <View style={styles.screen}>
        {header}
        <View
          style={styles.body}
          accessibilityLabel="Loading the prediction"
          accessibilityRole="progressbar"
        >
          <View style={styles.author}>
            <Skeleton width={36} height={36} round />
            <View style={styles.who}>
              <Skeleton width={120} height={14} />
              <Skeleton width={170} height={11} />
            </View>
          </View>
          <Skeleton width={150} height={22} round />
          <Skeleton height={14} />
          <Skeleton height={14} />
          <Skeleton width="60%" height={14} />
          <Skeleton height={56} round />
        </View>
      </View>
    );

  const first = p.author.name.split(" ")[0];
  const disclosed = p.disclosePosition && p.evidenceShares > 0;
  const unrealized =
    m && disclosed
      ? (bestBid(m, p.outcome) - p.entryPrice) * p.evidenceShares
      : 0;
  // Back and Fade only where an order can actually go through.
  const open = !!m && canTrade(m);
  const items = comments.data?.items ?? [];
  const yes = p.outcome === "Yes";

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {header}
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.body}>
          <View style={styles.author}>
            <Pressable
              onPress={() => openTrader(p.author.handle, p.author.isYou)}
              style={styles.authorLink}
              accessibilityRole="link"
            >
              <Avatar url={p.author.avatarUrl} size={36} />
              <View style={styles.who}>
                <Text style={styles.name}>{p.author.name}</Text>
                <Text style={styles.meta}>
                  {[
                    recordLine(records.byId.get(p.authorId), records.minSample),
                    ago(p.at, now),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
            </Pressable>
            {!p.author.isYou ? (
              <Button
                size="md"
                variant={isFollowing ? "outline" : "primary"}
                label={isFollowing ? "Following" : "Follow"}
                onPress={toggleFollow}
                accessibilityLabel={`${isFollowing ? "Unfollow" : "Follow"} ${p.author.name}`}
              />
            ) : null}
          </View>

          <View
            style={[
              styles.predicts,
              {
                backgroundColor: yes ? color.pos200 : color.neg200,
                borderColor: yes ? color.posLine : color.negLine,
              },
            ]}
          >
            <Text
              style={[
                styles.predictsText,
                { color: yes ? color.pos : color.neg },
              ]}
            >
              Predicts {p.outcome} · {p.confidence}
            </Text>
          </View>

          <Text style={styles.text}>{p.text}</Text>
          {p.invalidation ? (
            <Text style={styles.invalidation}>
              {/^out if/i.test(p.invalidation)
                ? p.invalidation
                : `Out if: ${p.invalidation}`}
            </Text>
          ) : null}

          {m ? (
            <Pressable
              onPress={() => router.push(`/market/${m.id}`)}
              style={styles.market}
              accessibilityRole="link"
            >
              <Text style={styles.marketTitle}>{m.shortTitle || m.title}</Text>
              <Text style={styles.marketMeta}>
                {disclosed ? (
                  <>
                    {first}: {p.evidenceShares.toLocaleString("en-US")}{" "}
                    {p.outcome} @ {price(p.entryPrice)} ·{" "}
                    <Text
                      style={{
                        color:
                          unrealized < 0
                            ? color.neg
                            : unrealized > 0
                              ? color.gain
                              : color.neutral700,
                        fontFamily: font.medium,
                      }}
                    >
                      {arrowUsd(unrealized)}
                    </Text>
                  </>
                ) : p.disclosePosition ? (
                  `${first}: no position`
                ) : (
                  `Called ${p.outcome} at ${price(p.entryPrice)}`
                )}
              </Text>
            </Pressable>
          ) : null}
          <Reactions
            post={p}
            showSave={false}
            onReply={() => replyBox.current?.focus()}
          />
        </View>

        <Text style={styles.section}>
          DISCUSSION · {Math.max(p.commentCount, items.length)}
        </Text>
        {comments.isPending ? (
          <View
            accessibilityLabel="Loading the discussion"
            accessibilityRole="progressbar"
          >
            {[0, 1].map((i) => (
              <View key={i} style={styles.comment}>
                <Skeleton width={140} height={12} />
                <Skeleton height={13} />
                <Skeleton width="65%" height={13} />
              </View>
            ))}
          </View>
        ) : (
          items.map((c) => (
            <Comment key={c.id} comment={c} authorId={p.authorId} />
          ))
        )}
        {comments.isSuccess && items.length === 0 ? (
          <Text style={styles.empty}>
            No replies yet. Be the first to add your read.
          </Text>
        ) : null}
        <Pressable
          onPress={() => replyBox.current?.focus()}
          style={({ pressed }) => [styles.join, pressed && styles.joinPressed]}
          accessibilityRole="button"
          accessibilityLabel="Reply: join the discussion"
        >
          <ChatCircleIcon size={16} weight="bold" color={color.neutral600} />
          <Text style={styles.joinText}>
            Join the discussion — add your read
          </Text>
        </Pressable>
      </ScrollView>

      <View
        style={[
          styles.bar,
          { paddingBottom: Math.max(insets.bottom, space[3]) },
        ]}
      >
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <View style={styles.barRow}>
          <View style={styles.replyBox}>
            <TextInput
              ref={replyBox}
              autoFocus={wantsReply === "1"}
              value={reply}
              onChangeText={setReply}
              placeholder="Reply…"
              placeholderTextColor="#94a197"
              selectionColor={color.pos}
              style={styles.replyInput}
              multiline
              maxLength={2000}
              accessibilityLabel="Reply"
            />
            {reply.trim() ? (
              <Pressable
                onPress={send}
                disabled={sending}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Send reply"
                style={styles.send}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={color.onPos} />
                ) : (
                  <ArrowUpIcon size={16} weight="bold" color={color.onPos} />
                )}
              </Pressable>
            ) : null}
          </View>
          {open && m && !reply.trim() ? (
            <>
              <BackButton
                tone="side"
                outcome={p.outcome}
                price={price(bestAsk(m, p.outcome))}
                onPress={() => setTrade(p.outcome)}
              />
              <FadeButton
                side={opposite(p.outcome)}
                price={price(bestAsk(m, opposite(p.outcome)))}
                onPress={() => setTrade(opposite(p.outcome))}
              />
            </>
          ) : null}
        </View>
      </View>

      {m ? (
        <TradeSheet
          post={p}
          market={m}
          outcome={trade}
          onClose={() => setTrade(null)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Comment({
  comment: c,
  authorId,
}: {
  comment: CommentDTO;
  authorId: string;
}) {
  const stake = c.stake;
  const isAuthor = c.authorId === authorId;
  const tint = stake ? (stake.outcome === "Yes" ? "pos" : "neg") : null;
  return (
    <View style={styles.comment}>
      <View style={styles.commentHead}>
        <Pressable
          onPress={() => openTrader(c.author.handle, c.author.isYou)}
          hitSlop={6}
          accessibilityRole="link"
        >
          <Text style={styles.commentName}>{c.author.name}</Text>
        </Pressable>
        <View
          style={[
            styles.stake,
            tint === "pos" && { backgroundColor: color.pos200 },
            tint === "neg" && { backgroundColor: color.neg200 },
          ]}
        >
          <Text
            style={[
              styles.stakeText,
              tint === "pos" && { color: color.pos },
              tint === "neg" && { color: color.neg },
            ]}
          >
            {stake
              ? `${stake.outcome} · ${Math.round(stake.shares).toLocaleString("en-US")}`
              : "No position"}
            {isAuthor ? " · author" : ""}
          </Text>
        </View>
      </View>
      <Text style={styles.commentText}>{c.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: font.medium,
    fontSize: 15,
    color: color.text,
  },
  spacer: { flex: 1 },
  scroll: { paddingBottom: space[6] },
  body: {
    paddingHorizontal: space[4],
    paddingVertical: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.divider,
  },
  author: { flexDirection: "row", alignItems: "center", gap: space[3] },
  authorLink: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  who: { flex: 1, gap: 3 },
  name: { fontFamily: font.medium, fontSize: 14, color: color.text },
  meta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.neutral700,
    fontVariant: ["tabular-nums"],
  },
  predicts: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  predictsText: { fontFamily: font.medium, fontSize: 12 },
  text: {
    fontFamily: font.regular,
    fontSize: 16,
    lineHeight: 23,
    color: color.text,
  },
  invalidation: {
    fontFamily: font.regular,
    fontSize: text.body,
    lineHeight: 20,
    color: color.neutral700,
  },
  market: {
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: space[4],
    marginTop: 2,
    borderRadius: radius.pill,
    backgroundColor: "#101613",
  },
  marketTitle: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.text,
  },
  marketMeta: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.neutral700,
    fontVariant: ["tabular-nums"],
  },
  section: {
    fontFamily: font.medium,
    fontSize: 12,
    letterSpacing: 0.72,
    color: "#94a197",
    paddingHorizontal: space[4],
    paddingTop: 14,
    paddingBottom: space[2],
  },
  comment: {
    gap: 4,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.divider,
  },
  commentHead: { flexDirection: "row", alignItems: "center", gap: space[2] },
  commentName: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.text,
  },
  stake: {
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: color.neutral300,
  },
  stakeText: {
    fontFamily: font.medium,
    fontSize: 11,
    color: color.neutral800,
    fontVariant: ["tabular-nums"],
  },
  commentText: {
    fontFamily: font.regular,
    fontSize: 14,
    lineHeight: 20,
    color: color.text,
  },
  empty: {
    fontFamily: font.regular,
    fontSize: text.body,
    color: color.neutral700,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.divider,
  },
  join: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    paddingHorizontal: space[4],
    paddingVertical: 18,
  },
  joinPressed: { opacity: 0.6 },
  joinText: {
    fontFamily: font.regular,
    fontSize: text.ui,
    color: color.neutral600,
  },
  bar: {
    paddingHorizontal: space[4],
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.divider,
    backgroundColor: color.bg,
    gap: space[2],
  },
  barRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  replyBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingLeft: space[3],
    paddingRight: 4,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: "#223029",
    backgroundColor: "#0c110f",
  },
  replyInput: {
    flex: 1,
    fontFamily: font.regular,
    fontSize: text.body,
    color: color.text,
    paddingVertical: 10,
    maxHeight: 110,
  },
  send: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.pos,
  },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg },
});
