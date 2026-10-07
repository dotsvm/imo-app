/** Money as people read it in notifications and errors: "$99.37". */
const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export const usd = (micros: number) => usdFormat.format(micros / 1_000_000);

/** "+$76.00" / "−$12.40", with a real minus sign. */
export const signedUsd = (micros: number) =>
  `${micros < 0 ? "−" : "+"}${usdFormat.format(Math.abs(micros) / 1_000_000)}`;
