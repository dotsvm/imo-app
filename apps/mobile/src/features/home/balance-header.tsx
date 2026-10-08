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
              <Text style={styles.label}>USDC on Solana</Text>
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
          <Skeleton width={190} height={44} style={{ marginVertical: 4 }} />
        )}
        {showToday ? (
          <Text style={[styles.today, { color: today > 0 ? color.pos : today < 0 ? color.neg : color.neutral700 }]}>
            {today > 0 ? "▲ " : today < 0 ? "▼ " : ""}
            {usd(Math.abs(Math.round(today)))} today
          </Text>
        ) : null}
      </View>
      {trading.live ? (
        <Button
          label="Deposit"
          size="lg"
          onPress={() => setAdding(true)}
          icon={<PlusIcon size={18} weight="bold" color={PRIMARY_INK} />}
        />
      ) : null}
      <AddFundsSheet open={adding} onClose={() => setAdding(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingTop: space[4] },
  text: { flex: 1, gap: 2 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { fontFamily: font.regular, fontSize: 14, color: color.neutral700 },
  coins: { flexDirection: "row", alignItems: "center" },
  coin: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: color.bg },
  coinBack: { marginLeft: -6 },
  amount: { fontFamily: font.semibold, fontSize: 46, letterSpacing: -2, color: color.text, fontVariant: ["tabular-nums"], marginTop: 2 },
  cents: { color: color.neutral600 },
  unknown: { color: color.neutral600 },
  today: { fontFamily: font.medium, fontSize: 15, fontVariant: ["tabular-nums"] },
});
