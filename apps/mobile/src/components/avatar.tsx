import { Image } from "expo-image";
import { StyleSheet } from "react-native";
import { absolute } from "~/lib/api";
import { color } from "~/theme/tokens";

export function Avatar({ url, size = 36 }: { url: string; size?: number }) {
  return (
    <Image
      source={{ uri: absolute(url) }}
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      contentFit="cover"
      transition={120}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: color.neutral300 },
});
