/**
 * A room's ⋯ menu, as a floating sheet: what the room is for, how loudly it
 * notifies you, who's in it, and — for its owner and moderators — who's
 * asking to join. Leave (members) or Archive (the owner) sit at the end.
 * Only what the API can do.
 */
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XIcon } from "phosphor-react-native/src/icons/X";
import type { RoomDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { api } from "~/lib/api";
import { openTrader } from "~/lib/nav";
import { color, font, radius, space } from "~/theme/tokens";

export type OpenRoom = Extract<RoomDTO, { locked: false }>;
type Notify = "All messages" | "Mentions" | "Nothing";
const NOTIFY: Notify[] = ["All messages", "Mentions", "Nothing"];

interface Props {
  open: boolean;
  room: OpenRoom;
  onClose: () => void;
}

export function RoomMenuSheet({ open, room: r, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [notify, setNotify] = useState<Notify | null>(r.notify);
  const [answered, setAnswered] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const staff = r.role === "Owner" || r.role === "Moderator";
  const requests = r.requests.filter((p) => !answered.includes(p.handle));
  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ["room", r.id] }), queryClient.invalidateQueries({ queryKey: ["rooms"] })]);

  async function act(key: string, run: () => Promise<unknown>) {
    setBusy(key);
    setProblem(null);
    try {
      await run();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function changeNotify(next: Notify) {
    const before = notify;
    setNotify(next);
    Haptics.selectionAsync().catch(() => {});
    api(`/rooms/${r.id}/notify`, { method: "PUT", body: { notify: next } })
      .then(refresh)
      .catch((error: unknown) => {
        setNotify(before);
        setProblem(error instanceof Error ? error.message : "Couldn't change notifications.");
      });
  }

  const answer = (handle: string, approve: boolean) =>
    act(`req:${handle}`, async () => {
      await api(`/rooms/${r.id}/requests/${handle}`, { body: { approve } });
      setAnswered((a) => [...a, handle]);
      await refresh();
    });

  function leave() {
    Alert.alert(`Leave ${r.name}?`, r.privacy === "Invite only" ? "You'll need to ask to join again." : "You can join again any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () =>
          act("leave", async () => {
            await api(`/rooms/${r.id}/join`, { method: "DELETE" });
            await refresh();
            onClose();
            router.back();
          }),
      },
    ]);
  }

  function archive() {
    Alert.alert(`Archive ${r.name}?`, "It stops taking new messages and leaves Discover. Members keep what was said.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        style: "destructive",
        onPress: () =>
          act("archive", async () => {
            await api(`/rooms/${r.id}/archive`, { body: {} });
            await refresh();
            onClose();
            router.back();
          }),
      },
    ]);
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { bottom: Math.max(insets.bottom, space[2]) }]}>
        <View style={styles.grip} />
        <View style={styles.head}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.title} numberOfLines={1}>
              {r.name}
            </Text>
            <Text style={styles.sub}>
              {r.privacy} · {r.memberCount.toLocaleString("en-US")} {r.memberCount === 1 ? "member" : "members"}
              {r.role ? ` · you're ${r.role === "Owner" ? "the owner" : `a ${r.role.toLowerCase()}`}` : ""}
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
            <XIcon size={15} weight="bold" color={color.text} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={{ gap: 18, paddingBottom: space[1] }}>
          {r.description || r.topics.length || r.rules ? (
            <View style={{ gap: 8 }}>
              {r.description ? <Text style={styles.body}>{r.description}</Text> : null}
              {r.topics.length ? (
                <View style={styles.topics}>
                  {r.topics.map((t) => (
                    <View key={t} style={styles.topic}>
                      <Text style={styles.topicText}>{t}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {r.rules ? (
                <>
                  <Text style={styles.label}>Rules</Text>
                  <Text style={styles.body}>{r.rules}</Text>
                </>
              ) : null}
            </View>
          ) : null}

          {r.role && notify ? (
            <View style={{ gap: 10 }}>
              <Text style={styles.label}>Notify me about</Text>
              <View style={styles.segments} accessibilityRole="radiogroup">
                {NOTIFY.map((n) => {
                  const on = n === notify;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => !on && changeNotify(n)}
                      style={[styles.segment, on && styles.segmentOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                    >
                      <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{n}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {staff && requests.length ? (
            <View style={{ gap: 4 }}>
              <Text style={styles.label}>Asking to join · {requests.length}</Text>
              {requests.map((p) => (
                <View key={p.handle} style={styles.person}>
                  <Avatar url={p.avatarUrl} size={36} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={styles.sub}>@{p.handle}</Text>
                  </View>
                  <Button
                    size="xs"
                    variant="quiet"
                    label="Decline"
                    onPress={() => answer(p.handle, false)}
                    disabled={!!busy}
                    accessibilityLabel={`Decline ${p.name}`}
                  />
                  <Button
                    size="xs"
                    label="Approve"
                    onPress={() => answer(p.handle, true)}
                    loading={busy === `req:${p.handle}`}
                    disabled={!!busy}
                    accessibilityLabel={`Approve ${p.name}`}
                  />
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ gap: 4 }}>
            <Text style={styles.label}>Members · {r.memberCount.toLocaleString("en-US")}</Text>
            {r.members.map((p) => {
              const role = p.id === r.ownerId ? "Owner" : r.moderators.includes(p.id) ? "Moderator" : null;
              const online = r.onlineIds.includes(p.id);
              return (
                <Pressable
                  key={p.handle}
                  onPress={() => {
                    onClose();
                    openTrader(p.handle, p.isYou);
                  }}
                  style={({ pressed }) => [styles.person, pressed && { opacity: 0.7 }]}
                  accessibilityRole="link"
                  accessibilityLabel={`${p.name}${role ? `, ${role}` : ""}${online ? ", online" : ""}`}
                >
                  <View>
                    <Avatar url={p.avatarUrl} size={36} />
                    {online ? <View style={styles.online} /> : null}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {p.name}
                      {p.isYou ? <Text style={styles.sub}> · you</Text> : null}
                    </Text>
                    <Text style={styles.sub}>@{p.handle}</Text>
                  </View>
                  {role ? (
                    <View style={styles.role}>
                      <Text style={styles.roleText}>{role}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
            {r.memberCount > r.members.length ? (
              <Text style={styles.sub}>and {(r.memberCount - r.members.length).toLocaleString("en-US")} more</Text>
            ) : null}
          </View>

          {problem ? <Text style={styles.problem}>{problem}</Text> : null}

          {r.role === "Owner" ? (
            <Button variant="quiet" accessibilityLabel="Archive room" onPress={archive} loading={busy === "archive"} disabled={!!busy} style={styles.danger}>
              <Text style={styles.dangerText}>Archive room</Text>
            </Button>
          ) : r.role ? (
            <Button variant="quiet" onPress={leave} loading={busy === "leave"} disabled={!!busy} style={styles.danger} accessibilityLabel="Leave room">
              <Text style={styles.dangerText}>Leave room</Text>
            </Button>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(4, 6, 5, 0.55)" },
  sheet: {
    position: "absolute",
    left: 8,
    right: 8,
    maxHeight: "84%",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: 10,
    paddingBottom: space[4],
    borderRadius: 32,
    backgroundColor: "#121815",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 -20px 60px -20px rgba(0,0,0,0.8)",
  },
  grip: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.18)" },
  head: { flexDirection: "row", alignItems: "center", gap: space[3], paddingTop: space[2] },
  title: { fontFamily: font.semibold, fontSize: 20, letterSpacing: -0.4, color: color.text },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  scroll: { flexGrow: 0 },
  label: { fontFamily: font.regular, fontSize: 12, color: color.muted, fontVariant: ["tabular-nums"] },
  sub: { fontFamily: font.regular, fontSize: 12, color: color.muted, fontVariant: ["tabular-nums"] },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: "#c6cec6" },
  topics: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  topic: { height: 26, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: "center", backgroundColor: color.card },
  topicText: { fontFamily: font.medium, fontSize: 12, color: "#c9cfcb" },
  segments: { flexDirection: "row", padding: 4, gap: 4, borderRadius: radius.pill, backgroundColor: "rgba(255,255,255,0.05)" },
  segment: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: color.text },
  segmentText: { fontFamily: font.regular, fontSize: 13, color: "#c9cfcb" },
  segmentTextOn: { fontFamily: font.semibold, color: "#0c100e" },
  person: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 8 },
  name: { fontFamily: font.medium, fontSize: 14, color: color.text },
  online: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: color.gain,
    borderWidth: 2,
    borderColor: "#121815",
  },
  role: { height: 22, paddingHorizontal: 9, borderRadius: radius.pill, justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  roleText: { fontFamily: font.medium, fontSize: 11, color: "#c9cfcb" },
  problem: { fontFamily: font.regular, fontSize: 13, color: color.neg },
  danger: { borderColor: "rgba(228, 153, 140, 0.35)" },
  dangerText: { fontFamily: font.semibold, fontSize: 15, color: color.neg },
});
