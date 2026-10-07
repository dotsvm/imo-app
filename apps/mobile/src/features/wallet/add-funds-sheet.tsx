/**
 * Add funds: how money gets into your wallet. Crypto on Solana works today;
 * card, Apple Pay and exchange transfers are shown as coming, not faked.
 */
import { router } from "expo-router";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppleLogoIcon } from "phosphor-react-native/src/icons/AppleLogo";
import { BankIcon } from "phosphor-react-native/src/icons/Bank";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import { CreditCardIcon } from "phosphor-react-native/src/icons/CreditCard";
import { LockSimpleIcon } from "phosphor-react-native/src/icons/LockSimple";
import { XIcon } from "phosphor-react-native/src/icons/X";
import { TOKEN_LOGOS } from "~/lib/logos";
import { color, font, radius, space, text } from "~/theme/tokens";

export function AddFundsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
        <View style={styles.grip} />
        <View style={styles.head}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.title}>Add funds</Text>
            <Text style={styles.sub}>Choose how you want to deposit</Text>
          </View>
          <Pressable onPress={onClose} style={styles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={16} weight="bold" color={color.neutral800} />
          </Pressable>
        </View>

        <View style={styles.list}>
          <Method
            icon={
              <View style={styles.icon} accessibilityLabel="USDC and SOL">
                <Image source={TOKEN_LOGOS.USDC} style={styles.coin} />
                <Image source={TOKEN_LOGOS.SOL} style={styles.coinBadge} />
              </View>
            }
            title="Crypto"
            detail="USDC or SOL on Solana · free"
            onPress={() => {
              onClose();
              router.push("/deposit");
            }}
          />
          <Method icon={<Muted><AppleLogoIcon size={20} weight="fill" color={color.neutral700} /></Muted>} title="Apple Pay" detail="Instant · card fees apply" soon />
          <Method icon={<Muted><CreditCardIcon size={20} color={color.neutral700} /></Muted>} title="Debit card" detail="Visa, Mastercard" soon />
          <Method icon={<Muted><BankIcon size={20} color={color.neutral700} /></Muted>} title="Exchange app" detail="Coinbase, Binance, Kraken" soon last />
        </View>

        <View style={styles.foot}>
          <LockSimpleIcon size={12} color={color.neutral600} />
          <Text style={styles.footText}>Deposits settle on Solana in seconds</Text>
        </View>
      </View>
    </Modal>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <View style={[styles.icon, styles.muted]}>{children}</View>;
}

function Method({
  icon,
  title,
  detail,
  onPress,
  soon,
  last,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  onPress?: () => void;
  soon?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={soon}
      style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityState={{ disabled: soon }}
      accessibilityLabel={soon ? `${title}, coming soon` : title}
    >
      {icon}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.rowTitle, soon && styles.dim]}>{title}</Text>
        <Text style={[styles.rowDetail, soon && styles.dimmer]}>{detail}</Text>
      </View>
      {soon ? (
        <View style={styles.soon}>
          <Text style={styles.soonText}>Soon</Text>
        </View>
      ) : (
        <CaretRightIcon size={16} color={color.neutral700} />
      )}
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
    paddingHorizontal: space[4],
    paddingTop: space[2],
    gap: space[4],
    borderTopLeftRadius: radius.drawer + 4,
    borderTopRightRadius: radius.drawer + 4,
    backgroundColor: "#0d1210",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
  },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: color.neutral500 },
  head: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: space[1], paddingTop: space[2] },
  title: { fontFamily: font.medium, fontSize: 20, letterSpacing: -0.4, color: color.text },
  sub: { fontFamily: font.regular, fontSize: 13, color: color.neutral700 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: color.neutral300 },
  list: { borderRadius: radius.panel, backgroundColor: "#141a17", overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[3], paddingVertical: 14 },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.neutral400 },
  rowPressed: { backgroundColor: "#19201c" },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  coin: { width: 36, height: 36, borderRadius: 18 },
  // SOL tucked at the corner of USDC: both work here.
  coinBadge: { position: "absolute", right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#141a17" },
  muted: { backgroundColor: color.neutral300 },
  rowTitle: { fontFamily: font.medium, fontSize: text.body + 1, color: color.text },
  rowDetail: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  dim: { color: color.neutral700 },
  dimmer: { color: color.neutral600 },
  soon: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: color.neutral500 },
  soonText: { fontFamily: font.medium, fontSize: 11, color: color.neutral600 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingBottom: space[1] },
  footText: { fontFamily: font.regular, fontSize: 11, color: color.neutral600 },
});
