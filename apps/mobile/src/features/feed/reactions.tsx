/**
 * A post's replies, likes and save, live. Like and save answer the instant
 * they're tapped (a small spring pop, a light tick), then the server's count
 * takes over; if the server says no, they go back. Replies opens the post
 * with the reply box ready.
 */
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { BookmarkSimpleIcon } from "phosphor-react-native/src/icons/BookmarkSimple";
import { ChatCircleIcon } from "phosphor-react-native/src/icons/ChatCircle";
import { HeartIcon } from "phosphor-react-native/src/icons/Heart";
import type { PostDTO } from "@imo/server/dto/api-types";
import { api } from "~/lib/api";
import { count } from "~/lib/format";
import { color, font } from "~/theme/tokens";

type Kind = "like" | "bookmark";

export function Reactions({
  post,
  onReply,
  showSave = true,
}: {
  post: PostDTO;
  onReply?: () => void;
  showSave?: boolean;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState({
    base: post,
    liked: !!post.viewer?.liked,
    saved: !!post.viewer?.bookmarked,
    likes: post.likes,
  });
  // Fresh data from the server (a refetch) replaces what was shown.
  if (state.base !== post)
    setState({
      base: post,
      liked: !!post.viewer?.liked,
      saved: !!post.viewer?.bookmarked,
      likes: post.likes,
    });

  async function react(kind: Kind) {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    const on = kind === "like" ? !state.liked : !state.saved;
    const before = state;
    setState((s) =>
      kind === "like"
        ? { ...s, liked: on, likes: Math.max(0, s.likes + (on ? 1 : -1)) }
        : { ...s, saved: on },
    );
    try {
      const fresh = await api<PostDTO>(`/posts/${post.id}/reactions/${kind}`, {
        method: on ? "PUT" : "DELETE",
      });
      setState((s) => ({
        ...s,
        liked: !!fresh.viewer?.liked,
        saved: !!fresh.viewer?.bookmarked,
        likes: fresh.likes,
      }));
      // Other screens showing this post catch up on their next look.
      queryClient.setQueryData(["post", post.id], fresh);
      if (kind === "bookmark")
        queryClient.invalidateQueries({ queryKey: ["feed", "bookmarks"] });
    } catch {
      setState(before);
    }
  }

  return (
    <View style={styles.row}>
      <Action
        label={`${post.commentCount} replies. Reply`}
        onPress={
          onReply ??
          (() =>
            router.push({
              pathname: "/post/[id]",
              params: { id: post.id, reply: "1" },
            }))
        }
        icon={
          <ChatCircleIcon size={18} weight="fill" color={color.neutral600} />
        }
        n={post.commentCount}
      />
      <Action
        label={
          state.liked
            ? `Unlike. ${state.likes} likes`
            : `Like. ${state.likes} likes`
        }
        selected={state.liked}
        onPress={() => react("like")}
        icon={
          <HeartIcon
            size={18}
            weight="fill"
            color={state.liked ? "#f0718a" : color.neutral600}
          />
        }
        n={state.likes}
        tint={state.liked ? "#f0718a" : undefined}
        pop
      />
      {showSave ? (
        <Action
          label={state.saved ? "Remove from saved" : "Save"}
          selected={state.saved}
          onPress={() => react("bookmark")}
          icon={
            <BookmarkSimpleIcon
              size={18}
              weight="fill"
              color={state.saved ? color.pos : color.neutral600}
            />
          }
          pop
        />
      ) : null}
    </View>
  );
}

function Action({
  icon,
  n,
  tint,
  label,
  selected,
  onPress,
  pop,
}: {
  icon: ReactNode;
  n?: number;
  tint?: string;
  label: string;
  selected?: boolean;
  onPress: () => void;
  pop?: boolean;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));
  return (
    <Pressable
      onPress={() => {
        // A tiny spring pop on the icon; nothing under reduced motion.
        if (pop && !reduced)
          scale.set(
            withSequence(
              withTiming(0.82, { duration: 70 }),
              withSpring(1, { damping: 9, stiffness: 320 }),
            ),
          );
        onPress();
      }}
      hitSlop={10}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
    >
      <Animated.View style={animated}>{icon}</Animated.View>
      {n !== undefined ? (
        <Text style={[styles.count, tint ? { color: tint } : null]}>
          {count(n)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 18 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingRight: 2,
  },
  pressed: { opacity: 0.6 },
  count: {
    fontFamily: font.regular,
    fontSize: 14,
    color: color.neutral700,
    fontVariant: ["tabular-nums"],
  },
});
