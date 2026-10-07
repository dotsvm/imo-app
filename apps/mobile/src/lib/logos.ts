/**
 * Official marks, bundled so they draw instantly and offline. Venue logos
 * come from each venue's own site; token logos from Jupiter's verified token
 * list (the same files wallets show). Anything not here falls back to its
 * letter mark — never a made-up logo.
 */
import type { ImageSourcePropType } from "react-native";

export const VENUE_LOGOS: Record<string, ImageSourcePropType> = {
  jupiter: require("../../assets/logos/jupiter.png"),
  polymarket: require("../../assets/logos/polymarket.png"),
  kalshi: require("../../assets/logos/kalshi.png"),
};

export const TOKEN_LOGOS = {
  USDC: require("../../assets/logos/usdc.png") as ImageSourcePropType,
  SOL: require("../../assets/logos/sol.png") as ImageSourcePropType,
  JupUSD: require("../../assets/logos/jupusd.png") as ImageSourcePropType,
};
