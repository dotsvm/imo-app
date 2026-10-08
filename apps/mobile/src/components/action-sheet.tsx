/**
 * A short list of actions in a bottom sheet (a profile's ··· menu), with
 * Cancel at the foot. Destructive actions read in coral.
 */
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font, radius, space } from "~/theme/tokens";

export interface SheetAction {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  destructive?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** A small line above the actions. */
  title?: string;
  actions: SheetAction[];
}

export function ActionSheet({ open, onClose, title, actions }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
        <View style={styles.grip} />
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {actions.map((a) => (
          <Pressable
            key={a.label}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.selectionAsync();
              onClose();
              a.onPress();
            }}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
          >
            {a.icon}
            <Text style={[styles.rowText, a.destructive && { color: color.neg }]}>{a.label}</Text>
          </Pressable>
        ))}
        <Pressable onPress={onClose} style={({ pressed }) => [styles.cancel, pressed && styles.rowPressed]} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
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
    backgroundColor: color.card,
    borderTopWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: color.neutral500, marginBottom: space[2] },
  title: { fontFamily: font.regular, fontSize: 12, color: color.muted, paddingHorizontal: space[3], paddingVertical: space[2] },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], height: 52, paddingHorizontal: space[3], borderRadius: radius.pill },
  rowPressed: { backgroundColor: "rgba(255, 255, 255, 0.05)" },
  rowText: { fontFamily: font.medium, fontSize: 15, color: color.text },
  cancel: { height: 48, alignItems: "center", justifyContent: "center", marginTop: space[1], borderRadius: radius.pill },
  cancelText: { fontFamily: font.medium, fontSize: 15, color: color.muted },
});
