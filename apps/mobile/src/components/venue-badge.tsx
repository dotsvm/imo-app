/** Where a market is traded, in a glance: the venue's own logo and name. */
import { StyleSheet, Text, View } from "react-native";
import { useVenues } from "~/lib/venues";
import { color, font } from "~/theme/tokens";
import { VenueMark } from "./venue-mark";

interface Props {
  venueId: string;
  /** Logo height. */
  size?: number;
  textStyle?: object;
}

export function VenueBadge({ venueId, size = 14, textStyle }: Props) {
  const name = useVenues().get(venueId)?.name ?? venueId;
  return (
    <View style={styles.row} accessibilityLabel={name}>
      <VenueMark venueId={venueId} size={size} />
      <Text style={[styles.name, textStyle]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  name: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
});
