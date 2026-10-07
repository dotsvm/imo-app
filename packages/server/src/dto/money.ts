/** The API speaks cents (what screens show); the ledger keeps micro-dollars.
    Conversions are exact: sub-cent prices come out fractional (62.5¢). */
export const MICROS_PER_CENT = 10_000;
export const cents = (micros: number) => micros / MICROS_PER_CENT;
export const micros = (cents: number) => Math.round(cents * MICROS_PER_CENT);
