/**
 * The floating tab bar: a rounded panel over the content. The current tab
 * opens into a light pill with its name; the others are icons; Profile is
 * your own picture, ringed green when it's the current tab. A light tick on change.
 */
import * as Haptics from "expo-haptics";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Platform, StyleSheet, Text, View } from "react-native";
import Animated, { LinearTransition, useReducedMotion } from "react-native-reanimated";
import type { Icon } from "phosphor-react-native";
import { ChartPieSliceIcon } from "phosphor-react-native/src/icons/ChartPieSlice";
import { CompassIcon } from "phosphor-react-native/src/icons/Compass";
import { HouseIcon } from "phosphor-react-native/src/icons/House";
import { UserCircleIcon } from "phosphor-react-native/src/icons/UserCircle";
import { UsersThreeIcon } from "phosphor-react-native/src/icons/UsersThree";
import { useMe } from "~/features/auth/use-account";
import { color, font, radius } from "~/theme/tokens";
import { Avatar } from "./avatar";
import { PressableScale } from "./pressable-scale";

const TABS: Record<string, { label: string; Icon: Icon }> = {
  index: { label: "Feed", Icon: HouseIcon },
  discover: { label: "Discover", Icon: CompassIcon },
  rooms: { label: "Rooms", Icon: UsersThreeIcon },
  portfolio: { label: "Portfolio", Icon: ChartPieSliceIcon },
  me: { label: "Profile", Icon: UserCircleIcon },
};

/** Height of the bar itself; screens pad their scroll content by this plus the inset. */
export const TAB_BAR_HEIGHT = 64;
/** The bar floats at least this far above the screen's bottom edge. */
export const TAB_BAR_GAP = 28;
/** How much of the screen's bottom the bar covers, for a given bottom safe-area inset. */
export const tabBarSpace = (insetBottom: number) => TAB_BAR_HEIGHT + Math.max(insetBottom, TAB_BAR_GAP);

const PILL_INK = "#0c100e";
const ICON = "#c9cfcb";

export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const me = useMe().data;
  const reduced = useReducedMotion();
  const layout = reduced ? undefined : LinearTransition.springify().damping(22).stiffness(260);
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, TAB_BAR_GAP) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const focused = state.index === index;
          const profile = route.name === "me" && !!me?.user.avatarUrl;
          const pill = focused && !profile;
          return (
            <Animated.View key={route.key} layout={layout}>
              <PressableScale
                style={[styles.item, pill && styles.itemOn]}
                pressedScale={0.94}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={tab.label}
                onPress={() => {
                  const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                  if (focused || event.defaultPrevented) return;
                  if (Platform.OS !== "web") Haptics.selectionAsync();
                  navigation.navigate(route.name, route.params);
                }}
              >
                {profile ? (
                  <View style={[styles.avatarRing, focused && styles.avatarRingOn]}>
                    <Avatar url={me!.user.avatarUrl} size={30} />
                  </View>
                ) : (
                  <tab.Icon size={focused ? 18 : 21} weight={focused ? "fill" : "bold"} color={focused ? PILL_INK : ICON} />
                )}
                {pill ? <Text style={styles.label}>{tab.label}</Text> : null}
              </PressableScale>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 18, pointerEvents: "box-none" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: TAB_BAR_HEIGHT,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(24, 31, 27, 0.92)",
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255, 255, 255, 0.08)", inset: true },
      { offsetX: 0, offsetY: 16, blurRadius: 32, spreadDistance: -12, color: "rgba(0, 0, 0, 0.8)" },
    ],
  },
  item: { height: 48, minWidth: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: radius.pill },
  itemOn: { backgroundColor: color.text, paddingHorizontal: 16 },
  label: { fontFamily: font.semibold, fontSize: 13, color: PILL_INK },
  avatarRing: { borderRadius: 17, borderWidth: 2, borderColor: "rgba(255, 255, 255, 0.18)" },
  avatarRingOn: { borderColor: color.pos },
});
