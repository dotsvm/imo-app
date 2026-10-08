/** A venue's round badge: its own logo, or (for a venue without one) its letter and color. */
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { VENUE_LOGO_GROUND, VENUE_LOGOS } from "~/lib/logos";
import { useVenues } from "~/lib/venues";
import { color, font } from "~/theme/tokens";

/** `tile`: a rounded square (market boxes) instead of a circle. */
export function VenueMark({ venueId, size = 18, tile }: { venueId: string; size?: number; tile?: boolean }) {
  const v = useVenues().get(venueId);
  const logo = VENUE_LOGOS[venueId];
  const round = { width: size, height: size, borderRadius: tile ? Math.round(size * 0.31) : size / 2 };
  if (logo) {
    const image = <Image source={logo} style={round} contentFit="cover" accessibilityLabel={v?.name ?? venueId} />;
    // A round logo drawn as a tile sits on its own ground color, so no corners show.
    const ground = tile ? VENUE_LOGO_GROUND[venueId] : undefined;
    return ground ? <View style={[round, styles.ground, { backgroundColor: ground }]}>{image}</View> : image;
  }
  return (
    <View style={[styles.mark, round, { backgroundColor: v?.color ?? color.neutral400 }]}>
      <Text style={[styles.text, { fontSize: size * 0.52 }]}>{v?.mark ?? venueId[0]?.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center" },
  ground: { overflow: "hidden" },
  text: { fontFamily: font.semibold, color: "#06140d" },
});
