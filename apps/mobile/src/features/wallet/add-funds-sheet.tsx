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
import { color, font, radius, space } from "~/theme/tokens";

export function AddFundsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { bottom: Math.max(insets.bottom, space[2]) }]}>
        <View style={styles.grip} />
        <View style={styles.head}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.title}>Add funds</Text>
            <Text style={styles.sub}>Choose how you want to deposit</Text>
          </View>
          <Pressable onPress={onClose} style={styles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={15} weight="bold" color={color.text} />
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
          <Method
            icon={
              <View style={[styles.icon, styles.apple]}>
                <AppleLogoIcon size={21} weight="fill" color="#0c100e" />
              </View>
            }
            title="Apple Pay"
            detail="Instant · card fees apply"
            soon
          />
          <Method icon={<Muted><CreditCardIcon size={21} weight="fill" color={color.text} /></Muted>} title="Debit card" detail="Visa, Mastercard" soon />
          <Method icon={<Muted><BankIcon size={21} weight="fill" color={color.text} /></Muted>} title="Exchange app" detail="Coinbase, Binance, Kraken" soon last />
        </View>

        <View style={styles.foot}>
          <LockSimpleIcon size={11} weight="fill" color="#5b6460" />
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
      style={({ pressed }) => [styles.row, !last && styles.rowLine, pressed && styles.rowPressed, soon && styles.soonRow]}
      accessibilityRole="button"
      accessibilityState={{ disabled: soon }}
      accessibilityLabel={soon ? `${title}, coming soon` : title}
    >
      {icon}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
      {soon ? (
        <View style={styles.soon}>
          <Text style={styles.soonText}>Soon</Text>
        </View>
      ) : (
        <CaretRightIcon size={14} weight="bold" color="#c9cfcb" />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(4, 6, 5, 0.55)" },
  // A floating sheet, clear of the screen's edges.
  sheet: {
    position: "absolute",
    left: 8,
    right: 8,
    paddingHorizontal: space[2],
    paddingTop: 10,
    paddingBottom: 18,
    borderRadius: 32,
    backgroundColor: "#121815",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 -20px 60px -20px rgba(0,0,0,0.8)",
  },
  grip: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "rgba(255, 255, 255, 0.18)" },
  head: { flexDirection: "row", alignItems: "center", paddingTop: 14, paddingRight: space[3], paddingBottom: space[2], paddingLeft: space[4] },
  title: { fontFamily: font.semibold, fontSize: 20, letterSpacing: -0.4, color: color.text },
  sub: { fontFamily: font.regular, fontSize: 13, color: color.muted },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255, 255, 255, 0.07)" },
  list: { marginTop: 6, borderRadius: 24, backgroundColor: "rgba(255, 255, 255, 0.035)", overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 72, paddingHorizontal: space[4], paddingVertical: 14 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: "rgba(255, 255, 255, 0.08)" },
  rowPressed: { backgroundColor: "rgba(255, 255, 255, 0.04)" },
  soonRow: { opacity: 0.42 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  coin: { width: 40, height: 40, borderRadius: 20 },
  // SOL tucked at the corner of USDC: both work here.
  coinBadge: { position: "absolute", right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "#121815" },
  apple: { backgroundColor: "#f4f5f1" },
  muted: { backgroundColor: "rgba(255, 255, 255, 0.08)" },
  rowTitle: { fontFamily: font.medium, fontSize: 15, color: color.text },
  rowDetail: { fontFamily: font.regular, fontSize: 12, color: color.muted },
  soon: { height: 22, paddingHorizontal: 9, justifyContent: "center", borderRadius: radius.pill, backgroundColor: "rgba(255, 255, 255, 0.08)" },
  soonText: { fontFamily: font.regular, fontSize: 11, color: "#c9cfcb" },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14 },
  footText: { fontFamily: font.regular, fontSize: 11, color: "#5b6460" },
});
