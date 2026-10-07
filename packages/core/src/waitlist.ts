/**
 * The waitlist's rules, shared by the server that keeps the line and the
 * page that shows it: how many founding passes there are, the editions a
 * pass comes in, and how far sharing moves you up.
 */

/** The first thousand to join hold a founding pass. */
export const FOUNDING_PASSES = 1_000;

/** The pass editions: the colour each holder picked. */
export const PASS_EDITIONS = ["classic", "macro", "crypto", "politics"] as const;
export type PassEdition = (typeof PASS_EDITIONS)[number];

/** Places you move up for sharing your pass (once), and for each friend who
    claims through your link. */
export const SHARE_BOOST = 10;
export const REFERRAL_BOOST = 10;
