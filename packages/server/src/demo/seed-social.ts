/**
 * The design's people, records, predictions, rooms and the demo viewer
 * (Jordan Reyes, signed in with the dev subject "you") — written through the
 * same records the product keeps: orders, fills, ledger lines, positions,
 * realized P&L, claims and settlements. The viewer's cash lands on the
 * design's figure with one ledger adjustment that says so.
 *
 * Demo profile only. Idempotent: a seeded database is left as it is.
 */
import { and, eq, inArray } from "drizzle-orm";
import { rankAt } from "@imo/core/rank";
import type { Logger } from "@imo/core/ports/runtime";
import type { Trader } from "@imo/domain/types";
import { markets as designMarkets, traders } from "@imo/domain/demo/hunch-data";
import { channelReads, defaultSettings, initialState, posts, rooms } from "@imo/domain/demo/fixtures";
import { AVATAR_COLORS, NOTIFICATION_PREFERENCES, PAPER_ROUTE } from "../catalogs";
import type { Db, Tx } from "../db/client";
import * as t from "../db/schema";
import { computeTraderStats } from "../usecases/stats";
import { DESIGN_SNAPSHOT, DESIGN_SOURCE } from "./design-source";

const CENT = 10_000;
const DAY = 86_400_000;
const NOW = new Date(DESIGN_SNAPSHOT);
const STARTING = 10_000 * 1_000_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The dev sign-in subject for the demo viewer. */
export const DEMO_VIEWER = "you";

const joinedAt = (label: string) => {
  const [month, year] = label.split(" ");
  const i = MONTHS.indexOf(month ?? "");
  return i >= 0 && year ? new Date(Date.UTC(Number(year), i, 1)) : new Date(NOW.getTime() - 180 * DAY);
};

/** Markets that closed before the snapshot: kept, hidden, for records. */
const ARCHIVED: Record<string, { title: string; closedAt: string; result: "Yes" | "No"; category: string }> = {};
for (const trader of traders)
  for (const h of trader.history)
    if (h.archived) ARCHIVED[h.marketId] = { ...h.archived, category: "Economics" };

interface Lot {
  marketId: string;
  outcome: "yes" | "no";
  shares: number;
  priceCents: number;
  feeCents: number;
  at: Date;
  exit?: { kind: "sell" | "settlement"; priceCents: number; feeCents: number; at: Date };
}

type MarketInfo = { id: string; slug: string; closesAt: Date; status: string };

/** One buy (and maybe its exit) as the engine would have recorded it. */
async function writeLot(tx: Tx, account: { id: string; userId: string }, lot: Lot, n: number) {
  const notional = Math.round(lot.shares * lot.priceCents * CENT);
  const fee = Math.round(lot.feeCents * CENT);
  const [buy] = await tx
    .insert(t.orders)
    .values({
      accountId: account.id,
      userId: account.userId,
      routeId: PAPER_ROUTE,
      marketId: lot.marketId,
      outcome: lot.outcome,
      side: "buy",
      type: "market",
      timeInForce: "ioc",
      quantity: lot.shares,
      filledQuantity: lot.shares,
      averagePrice: Math.round(lot.priceCents * CENT),
      status: "filled",
      clientOrderId: `seed-${account.userId.slice(0, 8)}-${n}-buy`,
      createdAt: lot.at,
    })
    .returning({ id: t.orders.id });
  await tx.insert(t.fills).values({
    orderId: buy.id,
    accountId: account.id,
    marketId: lot.marketId,
    outcome: lot.outcome,
    side: "buy",
    price: Math.round(lot.priceCents * CENT),
    quantity: lot.shares,
    notional,
    fees: [{ source: "venue", label: "Venue and imo fees", amount: fee }],
    feeTotal: fee,
    liquidity: "taker",
    createdAt: lot.at,
  });
  await tx.insert(t.ledgerEntries).values([
    { accountId: account.id, amount: -notional, currency: "USD", kind: "buy", refType: "order", refId: buy.id, createdAt: lot.at },
    ...(fee ? [{ accountId: account.id, amount: -fee, currency: "USD", kind: "venue_fee" as const, refType: "order", refId: buy.id, createdAt: lot.at }] : []),
  ]);
  if (!lot.exit) return -notional - fee;

  const proceeds = Math.round(lot.shares * lot.exit.priceCents * CENT);
  const exitFee = Math.round(lot.exit.feeCents * CENT);
  let ref: string | null = null;
  if (lot.exit.kind === "sell") {
    const [sell] = await tx
      .insert(t.orders)
      .values({
        accountId: account.id,
        userId: account.userId,
        routeId: PAPER_ROUTE,
        marketId: lot.marketId,
        outcome: lot.outcome,
        side: "sell",
        type: "market",
        timeInForce: "ioc",
        quantity: lot.shares,
        filledQuantity: lot.shares,
        averagePrice: Math.round(lot.exit.priceCents * CENT),
        status: "filled",
        clientOrderId: `seed-${account.userId.slice(0, 8)}-${n}-sell`,
        createdAt: lot.exit.at,
      })
      .returning({ id: t.orders.id });
    ref = sell.id;
    await tx.insert(t.fills).values({
      orderId: sell.id,
      accountId: account.id,
      marketId: lot.marketId,
      outcome: lot.outcome,
      side: "sell",
      price: Math.round(lot.exit.priceCents * CENT),
      quantity: lot.shares,
      notional: proceeds,
      fees: [{ source: "venue", label: "Venue and imo fees", amount: exitFee }],
      feeTotal: exitFee,
      liquidity: "taker",
      createdAt: lot.exit.at,
    });
  }
  const entries = [
    { amount: proceeds, kind: lot.exit.kind === "sell" ? ("sell" as const) : ("settlement" as const) },
    ...(exitFee ? [{ amount: -exitFee, kind: "venue_fee" as const }] : []),
  ].filter((e) => e.amount !== 0);
  if (entries.length)
    await tx.insert(t.ledgerEntries).values(
      entries.map((e) => ({
        accountId: account.id,
        amount: e.amount,
        currency: "USD",
        kind: e.kind,
        refType: ref ? "order" : "settlement",
        refId: ref,
        createdAt: lot.exit!.at,
      })),
    );
  await tx.insert(t.realizedPnl).values({
    accountId: account.id,
    marketId: lot.marketId,
    outcome: lot.outcome,
    kind: lot.exit.kind,
    quantity: lot.shares,
    proceeds,
    cost: notional,
    entryFees: fee,
    exitFees: exitFee,
    pnl: proceeds - exitFee - notional - fee,
    orderId: ref && lot.exit.kind === "sell" ? ref : null,
    openedAt: lot.at,
    closedAt: lot.exit.at,
  });
  return -notional - fee + proceeds - exitFee;
}

async function openPositions(tx: Tx, accountId: string, lots: Lot[]) {
  const open = new Map<string, { marketId: string; outcome: string; quantity: number; cost: number; fees: number; openedAt: Date }>();
  for (const lot of lots.filter((l) => !l.exit)) {
    const key = `${lot.marketId}:${lot.outcome}`;
    const p = open.get(key) ?? { marketId: lot.marketId, outcome: lot.outcome, quantity: 0, cost: 0, fees: 0, openedAt: lot.at };
    p.quantity += lot.shares;
    p.cost += lot.shares * lot.priceCents * CENT;
    p.fees += lot.feeCents * CENT;
    if (lot.at < p.openedAt) p.openedAt = lot.at;
    open.set(key, p);
  }
  if (open.size)
    await tx.insert(t.positions).values([...open.values()].map((p) => ({ accountId, ...p, updatedAt: NOW })));
}

async function createPerson(
  tx: Tx,
  trader: Trader,
  options: { isDemo: boolean; settings?: ReturnType<typeof defaultSettings> },
) {
  const created = joinedAt(trader.joined);
  const settings = options.settings;
  const [user] = await tx
    .insert(t.users)
    .values({
      handle: settings?.handle ?? trader.handle,
      displayName: settings?.displayName ?? trader.name,
      initials: trader.initials,
      color: AVATAR_COLORS[trader.handle.length % AVATAR_COLORS.length],
      bio: settings?.bio ?? trader.bio,
      focus: trader.focus,
      region: settings?.region ?? "",
      isDemo: options.isDemo,
      followersCount: trader.followers,
      followingCount: trader.following,
      createdAt: created,
    })
    .returning();
  await tx.insert(t.userSettings).values({
    userId: user.id,
    interests: settings?.interests ?? trader.interests,
    onboarded: true,
    email: settings?.email ?? null,
    theme: settings?.theme ?? "Midnight",
    priceInCents: settings?.priceInCents ?? true,
    showPositionsOnPosts: settings?.showPositionsOnPosts ?? true,
    appearOnLeaderboard: settings?.appearOnLeaderboard ?? true,
    privateOpenPositions: settings?.privateOpenPositions ?? trader.privatePositions,
  });
  await tx.insert(t.notificationPrefs).values(
    NOTIFICATION_PREFERENCES.map((p) => {
      const own = settings?.notifications.find((n) => n.id === p.id);
      return { userId: user.id, kind: p.id, app: own?.app ?? p.app, email: own?.email ?? p.email };
    }),
  );
  const [account] = await tx
    .insert(t.tradingAccounts)
    .values({ userId: user.id, routeId: PAPER_ROUTE, currency: "USD", cash: STARTING, startingBalance: STARTING, createdAt: created })
    .returning();
  await tx.insert(t.ledgerEntries).values({
    accountId: account.id,
    amount: STARTING,
    currency: "USD",
    kind: "deposit",
    memo: "Opening paper balance",
    createdAt: created,
  });
  return { user, account };
}

export async function seedDesignSocial(db: Db, log: Logger) {
  const [already] = await db
    .select({ id: t.users.id })
    .from(t.users)
    .where(and(eq(t.users.handle, traders[0].handle), eq(t.users.isDemo, true)));
  if (already) return { skipped: true as const };

  const summary = await db.transaction(async (tx) => {
    // Markets: the listed design markets are already in; archived ones go in hidden.
    for (const [slug, a] of Object.entries(ARCHIVED)) {
      const outcome = a.result === "Yes" ? "yes" : "no";
      await tx
        .insert(t.markets)
        .values({
          slug,
          venueId: "kalshi",
          externalId: `DESIGN-ARCHIVED-${slug.toUpperCase()}`,
          source: DESIGN_SOURCE,
          type: "binary",
          title: a.title,
          shortTitle: a.title.replace(/^Will (the )?/, "").replace(/\?$/, ""),
          description: "",
          rules: a.title,
          resolutionSource: "",
          categoryHints: [a.category],
          category: a.category,
          hidden: true,
          status: "resolved",
          resolution: { outcome, final: true },
          currency: "USD",
          tick: CENT,
          venueFee: { kind: "none" },
          closesAt: new Date(a.closedAt),
        })
        .onConflictDoNothing();
    }
    const marketRows: MarketInfo[] = await tx
      .select({ id: t.markets.id, slug: t.markets.slug, closesAt: t.markets.closesAt, status: t.markets.status })
      .from(t.markets)
      .where(inArray(t.markets.slug, [...designMarkets.map((m) => m.id), ...Object.keys(ARCHIVED)]));
    const market = new Map(marketRows.map((m) => [m.slug, m]));
    const resultOf = (slug: string) => {
      const listed = designMarkets.find((m) => m.id === slug);
      if (listed) return listed.status === "resolved" ? listed.resolution.outcome : undefined;
      return ARCHIVED[slug]?.result;
    };

    // People.
    const settings = defaultSettings();
    const people = new Map<string, { user: typeof t.users.$inferSelect; account: typeof t.tradingAccounts.$inferSelect }>();
    for (const trader of traders) {
      const you = trader.id === DEMO_VIEWER;
      people.set(trader.id, await createPerson(tx, trader, { isDemo: !you, settings: you ? settings : undefined }));
    }
    // Who follows whom among the design's people: everyone follows the
    // circle, and the circle follows a rotating share of everyone else. The
    // counts people show stay the design's.
    const CIRCLE = ["hazel", "dayo", "ren", "luis", "sam", "ann", "mira"];
    const community = traders.filter((x) => x.id !== DEMO_VIEWER && !CIRCLE.includes(x.id));
    const follows: (typeof t.follows.$inferInsert)[] = [];
    for (const [i, trader] of traders.entries()) {
      if (trader.id === DEMO_VIEWER) continue;
      for (const c of CIRCLE)
        if (c !== trader.id && people.has(c))
          follows.push({
            followerId: people.get(trader.id)!.user.id,
            followeeId: people.get(c)!.user.id,
            createdAt: new Date(NOW.getTime() - (i + 1) * 3_600_000),
          });
    }
    for (const [i, c] of CIRCLE.entries()) {
      if (!people.has(c)) continue;
      const start = (i * 7) % community.length;
      for (const [j, other] of [...community.slice(start), ...community.slice(0, start)].slice(0, 12).entries())
        follows.push({
          followerId: people.get(c)!.user.id,
          followeeId: people.get(other.id)!.user.id,
          createdAt: new Date(NOW.getTime() - (j + 1) * 5_400_000),
        });
    }
    if (follows.length) await tx.insert(t.follows).values(follows).onConflictDoNothing();

    const viewer = people.get(DEMO_VIEWER)!;
    await tx.insert(t.authIdentities).values({ provider: "dev", subject: DEMO_VIEWER, userId: viewer.user.id, email: settings.email });
    const userId = (designId: string) => people.get(designId)?.user.id;

    // Traders' records, from their disclosed history.
    let lots = 0;
    for (const trader of traders) {
      if (trader.id === DEMO_VIEWER) continue;
      const person = people.get(trader.id)!;
      const own: Lot[] = [];
      for (const [i, h] of trader.history.entries()) {
        const m = market.get(h.marketId);
        if (!m) continue;
        const result = resultOf(h.marketId);
        const closedAt = h.archived ? new Date(h.archived.closedAt) : m.status === "resolved" ? m.closesAt : new Date(NOW.getTime() - (2 + i) * DAY);
        own.push({
          marketId: m.id,
          outcome: h.outcome === "Yes" ? "yes" : "no",
          shares: h.shares,
          priceCents: h.entryPrice,
          feeCents: h.feeCents,
          at: new Date(closedAt.getTime() - (9 + i) * DAY),
          exit:
            h.exitPrice === undefined
              ? undefined
              : {
                  // Held to a result at 0¢ or 100¢ is a settlement; anything else was sold.
                  kind: result && (h.exitPrice === 0 || h.exitPrice === 100) ? "settlement" : "sell",
                  priceCents: h.exitPrice,
                  feeCents: 0,
                  at: closedAt,
                },
        });
      }
      let cash = STARTING;
      for (const lot of own) cash += await writeLot(tx, { id: person.account.id, userId: person.user.id }, lot, lots++);
      await openPositions(tx, person.account.id, own);
      await tx.update(t.tradingAccounts).set({ cash }).where(eq(t.tradingAccounts.id, person.account.id));

      // Their track record as the design states it.
      const rows: (typeof t.traderStats.$inferInsert)[] = (["7D", "30D", "90D", "All"] as const).map((period) => {
        const s = trader.stats[period];
        return {
          userId: person.user.id,
          period,
          category: "All",
          returnPct: s.returnPct,
          correct: s.correct,
          resolved: s.resolved,
          trades: s.trades,
          pnl: s.pnlCents * CENT,
          startingCapital: s.startingCapitalCents * CENT,
          record: period === "All" ? { ...trader.record } : null,
          curve: period === "30D" && trader.curve30 ? trader.curve30.map((c) => c * CENT) : null,
          computedAt: NOW,
        };
      });
      for (const [category, c] of Object.entries(trader.categories))
        rows.push({
          userId: person.user.id,
          period: "All",
          category,
          returnPct: 0,
          correct: c!.correct,
          resolved: c!.resolved,
          trades: 0,
          pnl: 0,
          startingCapital: 0,
          computedAt: NOW,
        });
      await tx.insert(t.traderStats).values(rows);
    }

    // The viewer: positions, closed trades, orders, a claim, and the design's cash.
    const state = initialState();
    const you = { id: viewer.account.id, userId: viewer.user.id };
    const viewerLots: Lot[] = [];
    for (const p of state.positions) {
      const m = market.get(p.marketId);
      if (!m) continue;
      for (const f of p.fills)
        viewerLots.push({
          marketId: m.id,
          outcome: p.outcome === "Yes" ? "yes" : "no",
          shares: f.shares,
          priceCents: f.priceCents,
          feeCents: f.feeCents,
          at: new Date(f.at),
        });
    }
    // Closed trades carry the design's own totals: cost, fees, proceeds.
    for (const c of state.closed) {
      const m = market.get(c.marketId);
      if (!m) continue;
      viewerLots.push({
        marketId: m.id,
        outcome: c.outcome === "Yes" ? "yes" : "no",
        shares: c.shares,
        priceCents: c.costCents / c.shares,
        feeCents: c.feeCents,
        at: new Date(c.fills[0]?.at ?? c.closedAt),
        exit: { kind: "sell", priceCents: c.proceedsCents / c.shares, feeCents: c.exitFeeCents, at: new Date(c.closedAt) },
      });
    }
    let cash = STARTING;
    for (const lot of viewerLots) cash += await writeLot(tx, you, lot, lots++);
    await openPositions(tx, you.id, viewerLots);
    // Open positions show the design's totals (its fills and totals differ
    // slightly; the balance adjustment below squares the cash).
    // Newest-changed shows first: update in reverse so the design's order holds.
    for (const pos of [...state.positions].reverse()) {
      const m = market.get(pos.marketId);
      if (!m) continue;
      await tx
        .update(t.positions)
        .set({ cost: pos.costCents * CENT, fees: pos.feeCents * CENT })
        .where(and(eq(t.positions.accountId, you.id), eq(t.positions.marketId, m.id), eq(t.positions.outcome, pos.outcome === "Yes" ? "yes" : "no")));
    }

    // Resolved markets are settled; a winning position waiting to be claimed gets its claim.
    for (const m of marketRows.filter((r) => r.status === "resolved")) {
      const outcome = resultOf(m.slug) === "Yes" ? "yes" : "no";
      await tx.insert(t.settlements).values({ marketId: m.id, outcome, settledAt: m.closesAt }).onConflictDoNothing();
      const held = await tx.select().from(t.positions).where(eq(t.positions.marketId, m.id));
      for (const p of held)
        if (p.outcome === outcome)
          await tx.insert(t.claims).values({
            accountId: p.accountId,
            marketId: m.id,
            outcome: p.outcome,
            quantity: p.quantity,
            payout: p.quantity * 1_000_000,
            status: "claimable",
            createdAt: m.closesAt,
          });
    }

    // Resting and failed orders, with the money they hold.
    let reserved = 0;
    for (const o of state.orders) {
      const m = market.get(o.quote.marketId);
      if (!m) continue;
      const remaining = o.quote.shares - o.filledShares;
      const holds = o.status === "pending" || o.status === "partial";
      const hold = holds ? Math.round((o.quote.totalCents * remaining) / o.quote.shares) * CENT : 0;
      reserved += hold;
      await tx.insert(t.orders).values({
        accountId: you.id,
        userId: you.userId,
        routeId: PAPER_ROUTE,
        marketId: m.id,
        outcome: o.quote.outcome === "Yes" ? "yes" : "no",
        side: o.quote.side === "Buy" ? "buy" : "sell",
        type: holds ? "limit" : "market",
        timeInForce: holds ? "gtc" : "ioc",
        limitPrice: holds ? o.quote.priceCents * CENT : null,
        quantity: o.quote.shares,
        filledQuantity: o.filledShares,
        averagePrice: o.filledShares ? o.quote.priceCents * CENT : null,
        reserved: hold,
        status: o.status === "pending" ? "open" : o.status === "failed" ? "failed" : o.status,
        reason: o.status === "failed" ? "No liquidity within 2¢ of the best price." : null,
        quote: { ...o.quote },
        clientOrderId: `seed-${o.id}`,
        createdAt: new Date(o.at),
      });
    }
    await tx.insert(t.ledgerEntries).values({
      accountId: you.id,
      amount: state.cashCents * CENT - cash,
      currency: "USD",
      kind: "adjustment",
      memo: "Opening balance matched to the sample account",
      // With the opening deposit, so it sits at the start of the history.
      createdAt: new Date(viewer.account.createdAt.getTime() + 1_000),
    });
    await tx
      .update(t.tradingAccounts)
      .set({ cash: state.cashCents * CENT, reserved })
      .where(eq(t.tradingAccounts.id, you.id));

    // Rooms.
    const roomIds = new Map<string, string>();
    const messageIds = new Map<string, string>();
    for (const room of rooms) {
      const owner = userId(room.owner);
      if (!owner) continue;
      const [row] = await tx
        .insert(t.rooms)
        .values({
          slug: room.id,
          name: room.name,
          description: room.description,
          symbol: room.symbol,
          ownerId: owner,
          privacy: room.privacy === "Public" ? "public" : "invite",
          disclosure: room.disclosure,
          rules: room.rules,
          memberCount: room.memberCount,
          createdAt: new Date(NOW.getTime() - 60 * DAY),
        })
        .returning();
      roomIds.set(room.id, row.id);
      for (const member of room.members) {
        const id = userId(member);
        if (!id) continue;
        await tx.insert(t.roomMembers).values({
          roomId: row.id,
          userId: id,
          role: member === room.owner ? "owner" : room.moderators.includes(member) ? "moderator" : "member",
          notify: member === DEMO_VIEWER ? ({ "All messages": "all", Mentions: "mentions", Nothing: "nothing" } as const)[room.notify] : "mentions",
          joinedAt: new Date(NOW.getTime() - 30 * DAY),
          lastSeenAt: NOW,
        });
      }
      for (const asker of room.requests) {
        const id = userId(asker);
        if (id) await tx.insert(t.roomRequests).values({ roomId: row.id, userId: id, createdAt: new Date(NOW.getTime() - DAY) });
      }
      const channelIds = new Map<string, string>();
      for (const [position, channel] of room.channels.entries()) {
        const [c] = await tx
          .insert(t.channels)
          .values({ roomId: row.id, slug: channel.id, topic: channel.topic, marketId: channel.marketId ? market.get(channel.marketId)?.id : null, position })
          .returning({ id: t.channels.id });
        channelIds.set(channel.id, c.id);
      }
      const ranks: string[] = [];
      for (const slug of room.watchlist) {
        const m = market.get(slug);
        if (!m) continue;
        const rank = rankAt(ranks, ranks.length);
        ranks.push(rank);
        await tx.insert(t.roomMarkets).values({ roomId: row.id, marketId: m.id, addedBy: owner, rank });
      }
      // Top-level messages first, so thread replies find their parents.
      for (const message of room.messages.toSorted((a, b) => Number(!!a.parentId) - Number(!!b.parentId))) {
        const author = userId(message.authorId);
        const channel = channelIds.get(message.channel);
        if (!author || !channel) continue;
        const [m] = await tx
          .insert(t.roomMessages)
          .values({
            roomId: row.id,
            channelId: channel,
            authorId: author,
            parentId: message.parentId ? (messageIds.get(message.parentId) ?? null) : null,
            text: message.text ?? "",
            marketId: message.marketId ? market.get(message.marketId)?.id : null,
            kind: message.kind === "join" ? "join" : "message",
            withIds: message.with?.map((w) => userId(w)).filter((w): w is string => !!w) ?? null,
            createdAt: new Date(message.at),
          })
          .returning({ id: t.roomMessages.id });
        messageIds.set(message.id, m.id);
      }
      for (const [key, at] of Object.entries(channelReads)) {
        const [roomSlug, channel] = key.split("/");
        if (roomSlug === room.id && channelIds.has(channel!))
          await tx.insert(t.channelReads).values({ userId: viewer.user.id, channelId: channelIds.get(channel!)!, lastReadAt: new Date(at) });
      }
    }

    // Predictions and their threads.
    const postIds = new Map<string, string>();
    for (const post of posts) {
      const author = userId(post.authorId);
      const m = market.get(post.marketId);
      if (!author || !m) continue;
      const at = new Date(post.at);
      const [row] = await tx
        .insert(t.posts)
        .values({
          authorId: author,
          marketId: m.id,
          outcome: post.outcome === "Yes" ? "yes" : "no",
          entryPrice: post.entryPrice * CENT,
          text: post.text,
          invalidation: post.invalidation ?? null,
          confidence: post.confidence,
          disclosePosition: post.disclosePosition,
          positionSnapshot: post.disclosePosition && post.evidenceShares
            ? { quantity: post.evidenceShares, averagePrice: post.entryPrice * CENT, outcome: post.outcome === "Yes" ? "yes" : "no" }
            : null,
          roomId: post.audience === "public" ? null : (roomIds.get(post.audience) ?? null),
          editableUntil: at,
          likes: post.likes,
          reposts: post.reposts,
          views: post.views,
          comments: post.comments.length,
          backed: post.backed,
          faded: post.faded,
          evidenceShares: post.evidenceShares,
          createdAt: at,
        })
        .returning({ id: t.posts.id });
      postIds.set(post.id, row.id);
      if (post.images.length)
        await tx.insert(t.postImages).values(
          post.images.map((image, position) => ({
            postId: row.id,
            storageKey: image.src,
            alt: image.alt,
            caption: image.caption,
            width: image.width,
            height: image.height,
            position,
          })),
        );
      const commentIds = new Map<string, string>();
      for (const c of post.comments.toSorted((a, b) => Number(!!a.parentId) - Number(!!b.parentId))) {
        const commenter = userId(c.authorId);
        if (!commenter) continue;
        const [created] = await tx
          .insert(t.comments)
          .values({
            postId: row.id,
            authorId: commenter,
            parentId: c.parentId ? (commentIds.get(c.parentId) ?? null) : null,
            text: c.text,
            likes: c.likes ?? 0,
            createdAt: new Date(c.at),
          })
          .returning({ id: t.comments.id });
        commentIds.set(c.id, created.id);
      }
    }

    // The viewer's follows, bookmarks, lists, alerts and notifications.
    for (const designId of state.following) {
      const id = userId(designId);
      if (id)
        await tx.insert(t.follows).values({ followerId: viewer.user.id, followeeId: id, notify: state.notifyTraders.includes(designId), createdAt: NOW });
    }
    for (const [kind, ids] of [["bookmark", state.bookmarked], ["like", state.liked]] as const)
      for (const designId of ids) {
        const id = postIds.get(designId);
        if (id) await tx.insert(t.reactions).values({ userId: viewer.user.id, subjectType: "post", subjectId: id, kind, createdAt: NOW });
      }
    const lists: { name: string; isDefault: boolean; markets: string[]; at: Date }[] = [
      { name: "Saved markets", isDefault: true, markets: state.watchlist, at: NOW },
      ...state.watchlists.map((w) => ({ name: w.name, isDefault: false, markets: w.marketIds, at: new Date(w.updatedAt) })),
    ];
    for (const [i, list] of lists.entries()) {
      // Lists show in the order they were made: the design's order.
      const made = new Date(NOW.getTime() - 30 * DAY + i * 60_000);
      const [row] = await tx
        .insert(t.watchlists)
        .values({ ownerId: viewer.user.id, name: list.name, isDefault: list.isDefault, createdAt: made, updatedAt: list.at })
        .returning({ id: t.watchlists.id });
      const ranks: string[] = [];
      for (const slug of list.markets) {
        const m = market.get(slug);
        if (!m) continue;
        const rank = rankAt(ranks, ranks.length);
        ranks.push(rank);
        await tx.insert(t.watchlistItems).values({ watchlistId: row.id, marketId: m.id, rank, addedAt: list.at });
      }
    }
    for (const alert of settings.alerts) {
      const m = market.get(alert.marketId);
      if (m)
        await tx.insert(t.priceAlerts).values({
          userId: viewer.user.id,
          marketId: m.id,
          outcome: alert.outcome === "Yes" ? "yes" : "no",
          threshold: alert.thresholdCents * CENT,
          direction: alert.direction,
          createdAt: NOW,
        });
    }
    // Links in the design point at design ids: rewrite them to real ones.
    const handleOf = (designId: string) => people.get(designId)?.user.handle ?? designId;
    const relink = (href: string) =>
      href
        .replace(/^\/post\/([\w-]+)/, (_, id: string) => `/post/${postIds.get(id) ?? id}`)
        .replace(/^\/trader\/([\w-]+)/, (_, id: string) => `/trader/${handleOf(id)}`);
    for (const n of state.notifications)
      await tx.insert(t.notifications).values({
        userId: viewer.user.id,
        kind: n.kind,
        icon: n.icon,
        title: n.title,
        body: n.body,
        href: relink(n.href),
        cta: n.cta ? { ...n.cta, href: relink(n.cta.href) } : null,
        dedupeKey: `seed:${n.id}`,
        createdAt: new Date(n.at),
        readAt: state.readNotifications.includes(n.id) ? new Date(n.at) : null,
      });

    return {
      people: people.size,
      rooms: roomIds.size,
      messages: messageIds.size,
      posts: postIds.size,
      lots,
      viewer: viewer.user.handle,
    };
  });
  // The viewer's record is computed like everyone real's: from the records
  // just written, so their profile has numbers before the worker runs.
  const [viewer] = await db.select({ id: t.users.id }).from(t.users).where(eq(t.users.handle, summary.viewer));
  if (viewer) await computeTraderStats(db, viewer.id, NOW);
  log.info("design social data seeded", summary);
  return summary;
}
