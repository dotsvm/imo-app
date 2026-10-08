/** A room's square badge: its photo, or its two-letter symbol on its colour, with a green dot when people are online. */
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { color, font } from "~/theme/tokens";

// For rooms without a colour of their own: a soft tint picked by id, so it stays put.
const TINTS = ["#b5e6a1", "#a8c3c7", "#cfc3a8", "#b3b9cc", "#d1b3b0", "#bdb3cf"];
const tintOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length]!;
};

interface Props {
  id: string;
  symbol: string;
  /** The room's chosen colour (hex) and photo, when it has them. */
  color?: string | null;
  avatarUrl?: string | null;
  size?: number;
  online?: boolean;
  /** Rooms you're not in yet sit quieter. */
  muted?: boolean;
}

export function RoomTile({ id, symbol, color: tint, avatarUrl, size = 44, online, muted }: Props) {
  // 48 → 16, 36 → 12, 64 → ~21: the design's soft squares.
  const shape = { width: size, height: size, borderRadius: Math.round(size / 3) };
  const dot = Math.max(10, Math.round(size / 4));
  return (
    <View>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={[shape, muted && styles.photoMuted]} contentFit="cover" />
      ) : (
        <View style={[styles.tile, shape, muted ? styles.muted : { backgroundColor: tint || tintOf(id) }]}>
          <Text style={[styles.symbol, { fontSize: Math.round(size * 0.29) }, muted && styles.symbolMuted]}>{symbol}</Text>
        </View>
      )}
      {online ? <View style={[styles.dot, { width: dot, height: dot, borderRadius: dot / 2 }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
  muted: { backgroundColor: color.card },
  photoMuted: { opacity: 0.7 },
  symbol: { fontFamily: font.semibold, color: "#0c100e" },
  symbolMuted: { color: "#c6cec6" },
  dot: {
    position: "absolute",
    right: -2,
    bottom: -2,
    backgroundColor: color.gain,
    borderWidth: 3,
    borderColor: color.bg,
  },
});
