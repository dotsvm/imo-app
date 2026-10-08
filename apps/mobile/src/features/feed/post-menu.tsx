/**
 * A post's ··· menu as a bottom sheet: follow or unfollow its author, and
 * Fade (take the other side) when the market's open.
 */
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowRightIcon } from "phosphor-react-native/src/icons/ArrowRight";
import { UserMinusIcon } from "phosphor-react-native/src/icons/UserMinus";
import { UserPlusIcon } from "phosphor-react-native/src/icons/UserPlus";
import type { MarketDTO, PostDTO } from "@imo/server/dto/api-types";
import { setFollowing } from "~/features/auth/onboarding";
import { price } from "~/lib/format";
import { bestAsk, opposite, type Outcome } from "~/lib/market";
import { color, font, radius, space, text } from "~/theme/tokens";
import { useCanTrade } from "~/features/trade/use-tradable";

interface Props {
  post: PostDTO;
  market: MarketDTO;
  open: boolean;
  onClose: () => void;
  onTrade: (outcome: Outcome) => void;
}

export function PostMenu({ post, market, open, onClose, onTrade }: Props) {
  const canTrade = useCanTrade();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const first = post.author.name.split(" ")[0];
  const [following, setFollowingState] = useState(post.author.viewer?.following ?? false);
  const other = opposite(post.outcome);
  const own = post.author.isYou;

  async function toggleFollow() {
    onClose();
    setFollowingState(!following);
    try {
      await setFollowing(post.author.handle, !following);
      queryClient.invalidateQueries({ queryKey: ["feed", "following"] });
    } catch {
      setFollowingState(following);
    }
  }

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
        <View style={styles.grip} />
        {!own ? (
          <Row
            icon={following ? <UserMinusIcon size={20} color={color.text} /> : <UserPlusIcon size={20} color={color.text} />}
            label={following ? `Unfollow ${first}` : `Follow ${first}`}
            onPress={toggleFollow}
          />
        ) : null}
        {canTrade(market) ? (
          <Row
            icon={<ArrowRightIcon size={20} color={color.text} />}
            label={`Fade · ${other} ${price(bestAsk(market, other))}`}
            onPress={() => {
              onClose();
              onTrade(other);
            }}
          />
        ) : null}
        <Pressable onPress={onClose} style={styles.cancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function Row({ icon, label, onPress }: { icon: ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} accessibilityRole="button">
      {icon}
      <Text style={styles.rowText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(5, 8, 6, 0.6)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space[3],
    paddingTop: space[2],
    borderTopLeftRadius: radius.drawer,
    borderTopRightRadius: radius.drawer,
    backgroundColor: color.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
  },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: color.neutral500, marginBottom: space[2] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], height: 52, paddingHorizontal: space[3], borderRadius: radius.card },
  rowPressed: { backgroundColor: color.neutral300 },
  rowText: { fontFamily: font.medium, fontSize: text.post, color: color.text },
  cancel: { height: 48, alignItems: "center", justifyContent: "center", marginTop: space[1] },
  cancelText: { fontFamily: font.medium, fontSize: text.post, color: color.neutral700 },
});
