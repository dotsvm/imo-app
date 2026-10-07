/**
 * The floating tab bar from the design: a rounded panel over the content,
 * filled icons, the current tab in positive green, a light tick on change.
 */
import * as Haptics from "expo-haptics";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { Icon } from "phosphor-react-native";
import { ChartPieSliceIcon } from "phosphor-react-native/src/icons/ChartPieSlice";
import { CompassIcon } from "phosphor-react-native/src/icons/Compass";
import { HouseIcon } from "phosphor-react-native/src/icons/House";
import { UserCircleIcon } from "phosphor-react-native/src/icons/UserCircle";
import { UsersThreeIcon } from "phosphor-react-native/src/icons/UsersThree";
import { color, font, radius, space } from "~/theme/tokens";
import { PressableScale } from "./pressable-scale";

const TABS: Record<string, { label: string; Icon: Icon }> = {
  index: { label: "Home", Icon: HouseIcon },
  discover: { label: "Discover", Icon: CompassIcon },
  rooms: { label: "Rooms", Icon: UsersThreeIcon },
  portfolio: { label: "Portfolio", Icon: ChartPieSliceIcon },
  me: { label: "Profile", Icon: UserCircleIcon },
};

/** Height of the bar itself; screens pad their scroll content by this plus the inset. */
export const TAB_BAR_HEIGHT = 64;

export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const focused = state.index === index;
          const tint = focused ? color.pos : color.neutral600;
          return (
            <PressableScale
              key={route.key}
              style={styles.item}
              pressedScale={0.92}
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
              <tab.Icon size={22} weight="fill" color={tint} />
              <Text style={[styles.label, { color: tint }]}>{tab.label}</Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space[4], pointerEvents: "box-none" },
  bar: {
    flexDirection: "row",
    height: TAB_BAR_HEIGHT,
    borderRadius: radius.drawer + 8,
    backgroundColor: "rgba(14, 17, 20, 0.96)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  label: { fontFamily: font.medium, fontSize: 11 },
});
