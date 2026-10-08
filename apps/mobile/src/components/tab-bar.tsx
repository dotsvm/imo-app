/**
 * The floating tab bar: a rounded panel over the content. The current tab
 * opens into a light pill with its name; the others are icons; Profile is
 * your own picture, ringed green when it's the current tab.
 *
 * One pill slides between tabs while the tab you leave narrows and the one
 * you pick widens, its label fading in and its icon turning dark under the
 * pill, all on one ease-out curve, so the bar moves as a single piece.
 */
import * as Haptics from "expo-haptics";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { useEffect, useState } from "react";
import { type LayoutChangeEvent, Platform, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
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
/** A resting tab: a 48 × 48 icon target. */
const SLOT = 48;
const ICON_ON = 18;
const PAD_X = 16;
const GAP = 7;
const BAR_PAD = 8;
/** Quick out, soft landing — no overshoot. */
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const DURATION = 320;

export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const me = useMe().data;
  const reduced = useReducedMotion();
  const routes = state.routes.filter((r) => TABS[r.name]);
  const active = routes.findIndex((r) => r.key === state.routes[state.index]?.key);
  const activeRoute = routes[active];
  const profileActive = activeRoute?.name === "me" && !!me?.user.avatarUrl;

  // Label widths, measured once off-screen, give each tab's open width.
  const [labels, setLabels] = useState<Record<string, number>>({});
  const [barWidth, setBarWidth] = useState(0);
  const openWidth = (name: string) => (labels[name] ? PAD_X * 2 + ICON_ON + GAP + labels[name] : SLOT);
  const isPill = (name: string) => !(name === "me" && !!me?.user.avatarUrl);
  const widthOf = (i: number) => (i === active && isPill(routes[i]!.name) ? openWidth(routes[i]!.name) : SLOT);

  // Where the pill lands: the tabs spread with space-between inside the bar.
  const inner = Math.max(0, barWidth - BAR_PAD * 2);
  const widths = routes.map((_, i) => widthOf(i));
  const spare = routes.length > 1 ? (inner - widths.reduce((s, w) => s + w, 0)) / (routes.length - 1) : 0;
  const pillX = BAR_PAD + widths.slice(0, Math.max(0, active)).reduce((s, w) => s + w + spare, 0);
  const pillW = active >= 0 ? widths[active]! : SLOT;
  const ready = barWidth > 0 && (!activeRoute || !isPill(activeRoute.name) || !!labels[activeRoute.name]);

  const x = useSharedValue(pillX);
  const w = useSharedValue(pillW);
  const shown = useSharedValue(ready && !profileActive ? 1 : 0);
  // The first placement lands at once; only later changes travel.
  const placed = useSharedValue(false);
  useEffect(() => {
    if (!ready) return;
    const first = !placed.get();
    placed.set(true);
    const t = (v: number) => (reduced || first ? v : withTiming(v, { duration: DURATION, easing: EASE }));
    x.set(t(pillX));
    w.set(t(pillW));
    shown.set(t(profileActive ? 0 : 1));
  }, [ready, pillX, pillW, profileActive, reduced, x, w, shown, placed]);
  const pill = useAnimatedStyle(() => ({ opacity: shown.get(), width: w.get(), transform: [{ translateX: x.get() }] }));

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, TAB_BAR_GAP) }]}>
      <View style={styles.bar} onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}>
        <Animated.View style={[styles.pill, pill]} pointerEvents="none" />
        {routes.map((route, i) => {
          const tab = TABS[route.name]!;
          const focused = i === active;
          const profile = route.name === "me" && !!me?.user.avatarUrl;
          return (
            <Tab
              key={route.key}
              label={tab.label}
              Icon={tab.Icon}
              focused={focused}
              openWidth={openWidth(route.name)}
              reduced={reduced}
              avatarUrl={profile ? me!.user.avatarUrl : null}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (focused || event.defaultPrevented) return;
                if (Platform.OS !== "web") Haptics.selectionAsync();
                navigation.navigate(route.name, route.params);
              }}
            />
          );
        })}
      </View>
      {/* Off-screen: each label's width, so a tab knows how wide it opens. */}
      <View style={styles.measure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {routes.map((route) => (
          <Text
            key={route.key}
            style={styles.label}
            onLayout={(e) => {
              const width = Math.ceil(e.nativeEvent.layout.width);
              setLabels((l) => (l[route.name] === width ? l : { ...l, [route.name]: width }));
            }}
          >
            {TABS[route.name]!.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Tab({
  label,
  Icon,
  focused,
  openWidth,
  reduced,
  avatarUrl,
  onPress,
}: {
  label: string;
  Icon: Icon;
  focused: boolean;
  openWidth: number;
  reduced: boolean;
  avatarUrl: string | null;
  onPress: () => void;
}) {
  const on = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    on.set(reduced ? (focused ? 1 : 0) : withTiming(focused ? 1 : 0, { duration: DURATION, easing: EASE }));
  }, [focused, reduced, on]);
  const pill = !avatarUrl;
  const box = useAnimatedStyle(() => ({ width: pill ? interpolate(on.get(), [0, 1], [SLOT, openWidth]) : SLOT }));

  return (
    <Animated.View style={box}>
      <PressableScale
        style={styles.item}
        pressedScale={0.94}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        onPress={onPress}
      >
        {avatarUrl ? (
          <View style={[styles.avatarRing, focused && styles.avatarRingOn]}>
            <Avatar url={avatarUrl} size={30} />
          </View>
        ) : (
          <>
            <TabIcon Icon={Icon} on={on} />
            <TabLabel label={label} on={on} />
          </>
        )}
      </PressableScale>
    </Animated.View>
  );
}

/** The light outline icon cross-fades into the dark filled one as the pill arrives. */
function TabIcon({ Icon, on }: { Icon: Icon; on: SharedValue<number> }) {
  const off = useAnimatedStyle(() => ({ opacity: 1 - on.get(), transform: [{ scale: interpolate(on.get(), [0, 1], [1, ICON_ON / 21]) }] }));
  const lit = useAnimatedStyle(() => ({ opacity: on.get(), transform: [{ scale: interpolate(on.get(), [0, 1], [21 / ICON_ON, 1]) }] }));
  return (
    <View style={styles.icon}>
      <Animated.View style={[styles.iconLayer, off]}>
        <Icon size={21} weight="bold" color={ICON} />
      </Animated.View>
      <Animated.View style={[styles.iconLayer, lit]}>
        <Icon size={ICON_ON} weight="fill" color={PILL_INK} />
      </Animated.View>
    </View>
  );
}

/** The name fades and slides in once the tab has started to open. */
function TabLabel({ label, on }: { label: string; on: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = interpolate(on.get(), [0.35, 1], [0, 1], "clamp");
    return {
      opacity: t,
      maxWidth: interpolate(on.get(), [0, 1], [0, 120]),
      marginLeft: interpolate(on.get(), [0, 1], [0, GAP]),
      transform: [{ translateX: (1 - t) * -6 }],
    };
  });
  return (
    <Animated.Text style={[styles.label, style]} numberOfLines={1}>
      {label}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 18, pointerEvents: "box-none" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: TAB_BAR_HEIGHT,
    paddingHorizontal: BAR_PAD,
    borderRadius: radius.pill,
    backgroundColor: "rgba(24, 31, 27, 0.92)",
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 0, color: "rgba(255, 255, 255, 0.08)", inset: true },
      { offsetX: 0, offsetY: 16, blurRadius: 32, spreadDistance: -12, color: "rgba(0, 0, 0, 0.8)" },
    ],
  },
  pill: { position: "absolute", left: 0, top: (TAB_BAR_HEIGHT - SLOT) / 2, height: SLOT, borderRadius: radius.pill, backgroundColor: color.text },
  item: { height: SLOT, flexDirection: "row", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  icon: { width: 21, height: 21, alignItems: "center", justifyContent: "center" },
  iconLayer: { position: "absolute" },
  label: { fontFamily: font.semibold, fontSize: 13, color: PILL_INK },
  measure: { position: "absolute", opacity: 0, left: -1000, top: 0, flexDirection: "row" },
  avatarRing: { borderRadius: 17, borderWidth: 2, borderColor: "rgba(255, 255, 255, 0.18)" },
  avatarRingOn: { borderColor: color.pos },
});
