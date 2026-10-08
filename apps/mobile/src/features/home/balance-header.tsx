/**
 * Home's money line: what's in your wallet to trade with (USDC on Solana),
 * how your open positions moved today, and Deposit. On a paper server, the
 * demo balance instead.
 *
 * "Today" is real: each open position's shares times its market's 24-hour
 * price move, on the side you hold. No positions, no line.
 */
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import type { MarketPage, PortfolioDTO } from "@imo/server/dto/api-types";
import { Button, PRIMARY_INK } from "~/components/button";
import { Skeleton } from "~/components/skeleton";
import { AddFundsSheet } from "~/features/wallet/add-funds-sheet";
import { useTrading } from "~/features/wallet/use-trading";
import { api } from "~/lib/api";
import { usd } from "~/lib/format";
import { TOKEN_LOGOS } from "~/lib/logos";
import { color, font, space } from "~/theme/tokens";

export function BalanceHeader() {
  const trading = useTrading();
  const [adding, setAdding] = useState(false);
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: ({ signal }) => api<PortfolioDTO>("/portfolio", { signal }) });
  const held = portfolio.data?.positions ?? [];
  const slugs = [...new Set(held.map((p) => p.marketId))];
  const markets = useQuery({
    queryKey: ["markets", "byIds", slugs.join(",")],
    queryFn: ({ signal }) => api<MarketPage>("/markets", { query: { ids: slugs.join(","), limit: slugs.length }, signal }),
    enabled: slugs.length > 0,
  });
  const moveOf = new Map((markets.data?.items ?? []).map((m) => [m.id, m.change]));
  // Cents: a Yes share moves with the market's 24h change, a No share against it.
  const today = held.reduce((sum, p) => sum + p.shares * (moveOf.get(p.marketId) ?? 0) * (p.outcome === "Yes" ? 1 : -1), 0);
  const showToday = held.length > 0 && markets.isSuccess;

  const cents = trading.availableCents;
  const [dollars, fraction] = cents !== null ? usd(cents).split(".") : ["", ""];

  return (
    <View style={styles.wrap}>
      <View style={styles.text}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>{trading.live ? "Balance" : "Demo balance"}</Text>
          {trading.live ? (
            <>
              <View style={styles.coins} accessibilityElementsHidden>
                <Image source={TOKEN_LOGOS.USDC} style={styles.coin} />
                <Image source={TOKEN_LOGOS.SOL} style={[styles.coin, styles.coinBack]} />
              </View>
              <Text style={styles.chain}>USDC on Solana</Text>
            </>
          ) : null}
        </View>
        {cents !== null ? (
          <Text style={styles.amount} accessibilityLabel={usd(cents)}>
            {dollars}
            <Text style={styles.cents}>.{fraction}</Text>
          </Text>
        ) : trading.live && trading.info ? (
          <Text style={[styles.amount, styles.unknown]} accessibilityLabel="Balance unavailable">
            —
          </Text>
        ) : (
          <Skeleton width={190} height={38} style={styles.amountSkeleton} />
        )}
        {showToday ? (
          <Text style={[styles.today, { color: today > 0 ? color.gain : today < 0 ? color.neg : color.neutral700 }]}>
            {today > 0 ? "▲ " : today < 0 ? "▼ " : ""}
            {usd(Math.abs(Math.round(today)))} today
          </Text>
        ) : null}
      </View>
      {trading.live ? (
        <Button
          label="Deposit"
          size="ml"
          onPress={() => setAdding(true)}
          icon={<PlusIcon size={13} weight="bold" color={PRIMARY_INK} />}
        />
      ) : null}
      <AddFundsSheet open={adding} onClose={() => setAdding(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: 20, paddingTop: 18, paddingBottom: 4 },
  text: { flex: 1, gap: 6 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  chain: { fontFamily: font.regular, fontSize: 12, color: "#c9cfcb", marginLeft: -3 },
  coins: { flexDirection: "row", alignItems: "center", marginHorizontal: -2 },
  // 16px coins, each ringed 2px in the page color (the ring sits outside the coin).
  coin: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: color.bg },
  coinBack: { marginLeft: -8 },
  amount: {
    fontFamily: font.semibold,
    fontSize: 38,
    lineHeight: 38,
    letterSpacing: -1.5,
    color: color.text,
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  amountSkeleton: { marginTop: 2 },
  cents: { color: "#5b6460" },
  unknown: { color: color.neutral600 },
  today: { fontFamily: font.medium, fontSize: 13, fontVariant: ["tabular-nums"] },
});
