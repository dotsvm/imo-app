/** A venue's round badge: its own logo, or (for a venue without one) its letter and color. */
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { VENUE_LOGOS } from "~/lib/logos";
import { useVenues } from "~/lib/venues";
import { color, font } from "~/theme/tokens";

export function VenueMark({ venueId, size = 18 }: { venueId: string; size?: number }) {
  const v = useVenues().get(venueId);
  const logo = VENUE_LOGOS[venueId];
  const round = { width: size, height: size, borderRadius: size / 2 };
  if (logo) return <Image source={logo} style={round} contentFit="cover" accessibilityLabel={v?.name ?? venueId} />;
  return (
    <View style={[styles.mark, round, { backgroundColor: v?.color ?? color.neutral400 }]}>
      <Text style={[styles.text, { fontSize: size * 0.52 }]}>{v?.mark ?? venueId[0]?.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: "center", justifyContent: "center" },
  text: { fontFamily: font.semibold, color: "#06140d" },
});
