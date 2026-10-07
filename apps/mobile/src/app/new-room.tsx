/**
 * New room: its badge (initials on a colour, or a photo), name and what it's
 * for, topics people find it by, who can join, and the people to bring in
 * from the start. You own it; markets are added from inside.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraIcon } from "phosphor-react-native/src/icons/Camera";
import { GlobeHemisphereWestIcon } from "phosphor-react-native/src/icons/GlobeHemisphereWest";
import { LockSimpleIcon } from "phosphor-react-native/src/icons/LockSimple";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import { XIcon } from "phosphor-react-native/src/icons/X";
import { Avatar } from "~/components/avatar";
import { Button } from "~/components/button";
import { AddPeopleSheet, type Person } from "~/features/rooms/add-people-sheet";
import { api } from "~/lib/api";
import { color, font, radius, space, text } from "~/theme/tokens";

type Privacy = "Public" | "Invite only";

/** The server's room colours (ROOM_COLORS), by key. */
const COLORS = {
  lavender: "#b9bbd6",
  sage: "#a9c4b1",
  sand: "#d8c9a3",
  rose: "#d8b0b0",
  sky: "#a9c4d5",
} as const;
type ColorKey = keyof typeof COLORS;

const SUGGESTED = ["Economy", "Fed", "Rates", "Politics", "Crypto", "Tech", "Sports", "Culture"];
const NAME_MAX = 40;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "R";

interface Photo {
  uri: string;
  key: string | null;
  uploading: boolean;
}

export default function NewRoom() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [tint, setTint] = useState<ColorKey>("lavender");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [topics, setTopics] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draftTopic, setDraftTopic] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("Public");
  const [people, setPeople] = useState<Person[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = name.trim().length >= 3 && !photo?.uploading;

  const toggleTopic = (t: string) =>
    setTopics((all) => (all.includes(t) ? all.filter((x) => x !== t) : all.length >= 6 ? all : [...all, t]));

  function addTopic() {
    const t = draftTopic.trim().replace(/\s+/g, " ").slice(0, 24);
    setDraftTopic("");
    setAdding(false);
    if (!t || [...SUGGESTED, ...custom].some((x) => x.toLowerCase() === t.toLowerCase())) return;
    setCustom((c) => [...c, t]);
    setTopics((all) => (all.length >= 6 ? all : [...all, t]));
  }

  async function choosePhoto() {
    setProblem(null);
    let picker: typeof import("expo-image-picker");
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      picker = require("expo-image-picker");
    } catch {
      setProblem("Photos need the latest imo app build.");
      return;
    }
    const picked = await picker
      .launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 })
      .catch(() => null);
    const asset = picked && !picked.canceled ? picked.assets[0] : null;
    if (!asset) return;
    const type = asset.mimeType ?? "image/jpeg";
    setPhoto({ uri: asset.uri, key: null, uploading: true });
    try {
      const bytes = await (await fetch(asset.uri)).blob();
      const { key, upload } = await api<{ key: string; upload: { url: string; fields?: Record<string, string> } }>("/uploads", {
        body: { purpose: "room", contentType: type, bytes: bytes.size },
      });
      // Straight to storage; the API never carries the bytes.
      const sent = await fetch(upload.url, { method: upload.fields?.method ?? "PUT", headers: { "content-type": type }, body: bytes });
      if (!sent.ok) throw new Error("The photo didn't upload. Try again.");
      setPhoto({ uri: asset.uri, key, uploading: false });
    } catch (error) {
      setPhoto(null);
      setProblem(error instanceof Error ? error.message : "The photo didn't upload. Try again.");
    }
  }

  async function create() {
    setBusy(true);
    setProblem(null);
    try {
      const room = await api<{ id: string }>("/rooms", {
        body: {
          name: name.trim(),
          description: about.trim(),
          privacy,
          color: tint,
          ...(photo?.key ? { avatarKey: photo.key } : {}),
          topics,
          invite: people.map((p) => p.handle),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
      router.replace(`/room/${room.id}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't create the room. Try again.");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: Platform.OS === "ios" ? space[3] : insets.top + space[2] }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerClose} accessibilityRole="button" accessibilityLabel="Close">
          <XIcon size={20} weight="bold" color={color.text} />
        </Pressable>
        <Text style={styles.headerTitle}>New room</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.identity}>
          <Pressable onPress={choosePhoto} accessibilityRole="button" accessibilityLabel={photo ? "Change the room's photo" : "Add a photo"}>
            <View style={[styles.badge, { backgroundColor: COLORS[tint] }]}>
              {photo ? (
                <Image source={{ uri: photo.uri }} style={[styles.badgePhoto, photo.uploading && { opacity: 0.5 }]} contentFit="cover" />
              ) : (
                <Text style={styles.badgeText}>{initials(name)}</Text>
              )}
            </View>
            <View style={styles.camera}>
              <CameraIcon size={12} weight="bold" color="#14181a" />
            </View>
          </Pressable>
          <View style={styles.nameBox}>
            <TextInput
              value={name}
              onChangeText={(v) => setName(v.slice(0, NAME_MAX))}
              placeholder="Room name"
              placeholderTextColor={color.neutral500}
              style={styles.name}
              autoFocus
              maxLength={NAME_MAX}
              accessibilityLabel="Room name"
            />
            <Text style={styles.count}>
              {name.length} / {NAME_MAX}
            </Text>
          </View>
        </View>

        {photo ? (
          <Pressable onPress={() => setPhoto(null)} hitSlop={6} style={styles.removePhoto} accessibilityRole="button">
            <Text style={styles.removePhotoText}>{photo.uploading ? "Uploading photo…" : "Remove photo"}</Text>
          </Pressable>
        ) : (
          <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel="Badge colour">
            {(Object.keys(COLORS) as ColorKey[]).map((k) => {
              const on = k === tint;
              return (
                <Pressable
                  key={k}
                  onPress={() => setTint(k)}
                  hitSlop={4}
                  style={[styles.swatchRing, on && styles.swatchRingOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={k}
                >
                  <View style={[styles.swatch, { backgroundColor: COLORS[k] }]} />
                </Pressable>
              );
            })}
          </View>
        )}

        <TextInput
          value={about}
          onChangeText={setAbout}
          placeholder="What’s it for? Rate calls, CPI prints, every FOMC week."
          placeholderTextColor={color.neutral600}
          style={styles.about}
          multiline
          maxLength={280}
          accessibilityLabel="What the room is for"
        />

        <Text style={styles.label}>Topics</Text>
        <View style={styles.chips}>
          {[...SUGGESTED, ...custom].map((t) => {
            const on = topics.includes(t);
            return (
              <Pressable
                key={t}
                onPress={() => toggleTopic(t)}
                style={[styles.chip, on && styles.chipOn]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{t}</Text>
              </Pressable>
            );
          })}
          {adding ? (
            <TextInput
              value={draftTopic}
              onChangeText={setDraftTopic}
              onSubmitEditing={addTopic}
              onBlur={addTopic}
              placeholder="Topic"
              placeholderTextColor={color.neutral600}
              autoFocus
              maxLength={24}
              returnKeyType="done"
              style={[styles.chip, styles.chipInput]}
            />
          ) : (
            <Pressable onPress={() => setAdding(true)} style={styles.chip} accessibilityRole="button" accessibilityLabel="Add a topic">
              <Text style={styles.chipText}>+ Add</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.label}>Who can join</Text>
        <View style={styles.group}>
          <Choice
            icon={<GlobeHemisphereWestIcon size={18} color={color.neutral800} />}
            title="Public"
            detail="Anyone can find and join"
            on={privacy === "Public"}
            onPress={() => setPrivacy("Public")}
          />
          <Choice
            icon={<LockSimpleIcon size={18} color={color.neutral800} />}
            title="Invite only"
            detail="People you add, or approve when they ask"
            on={privacy === "Invite only"}
            onPress={() => setPrivacy("Invite only")}
            last
          />
        </View>

        <View style={styles.inviteHead}>
          <Text style={[styles.label, { marginTop: 0 }]}>Invite</Text>
          {people.length ? <Text style={styles.label}>{people.length} added</Text> : null}
        </View>
        <View style={styles.inviteRow}>
          {people.length ? (
            <View style={styles.stack} accessibilityLabel={people.map((p) => p.name).join(", ")}>
              {people.slice(0, 4).map((p, i) => (
                <View key={p.handle} style={[styles.stackItem, i > 0 && { marginLeft: -10 }]}>
                  <Avatar url={p.avatarUrl} size={34} />
                </View>
              ))}
              {people.length > 4 ? <Text style={styles.more}>+{people.length - 4}</Text> : null}
            </View>
          ) : null}
          <Pressable onPress={() => setPicking(true)} style={styles.addPeople} accessibilityRole="button">
            <PlusIcon size={14} weight="bold" color={color.text} />
            <Text style={styles.addPeopleText}>{people.length ? "Add more" : "Add people"}</Text>
          </Pressable>
        </View>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: Math.max(insets.bottom, space[3]) }]}>
        <Button size="lg" label="Create room" onPress={create} disabled={!ready} loading={busy} />
      </View>

      <AddPeopleSheet open={picking} added={people} onChange={setPeople} onClose={() => setPicking(false)} />
    </KeyboardAvoidingView>
  );
}

function Choice({
  icon,
  title,
  detail,
  on,
  onPress,
  last,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  on: boolean;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.choice, !last && styles.choiceLine]}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
    >
      {icon}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceDetail}>{detail}</Text>
      </View>
      <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingBottom: space[3] },
  headerClose: { width: 28, height: 32, justifyContent: "center" },
  headerTitle: { fontFamily: font.medium, fontSize: 17, color: color.text },
  body: { paddingHorizontal: space[4], paddingBottom: space[6] },
  identity: { flexDirection: "row", alignItems: "center", gap: space[4], marginTop: space[2] },
  badge: { width: 64, height: 64, borderRadius: radius.panel, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  badgePhoto: { width: 64, height: 64 },
  badgeText: { fontFamily: font.semibold, fontSize: 22, letterSpacing: -0.4, color: "#1a1f22" },
  camera: {
    position: "absolute",
    right: -5,
    bottom: -5,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f2f1ec",
    borderWidth: 2,
    borderColor: color.bg,
  },
  nameBox: { flex: 1, gap: 2 },
  name: { fontFamily: font.medium, fontSize: 24, letterSpacing: -0.6, color: color.text, paddingVertical: 2 },
  count: { fontFamily: font.regular, fontSize: 12, color: color.neutral600, fontVariant: ["tabular-nums"] },
  swatches: { flexDirection: "row", gap: space[3], marginTop: space[4] },
  swatchRing: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  swatchRingOn: { borderColor: color.text },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  removePhoto: { alignSelf: "flex-start", marginTop: space[3] },
  removePhotoText: { fontFamily: font.medium, fontSize: 12, color: color.neutral700 },
  about: { fontFamily: font.regular, fontSize: text.body + 1, lineHeight: 22, color: color.text, marginTop: space[5], paddingVertical: 4, minHeight: 48 },
  label: { fontFamily: font.regular, fontSize: 12, color: color.neutral700, marginTop: space[6], marginBottom: space[3] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  chip: { height: 34, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: "center", backgroundColor: "#151a17" },
  chipOn: { backgroundColor: color.pos100, borderWidth: 1, borderColor: color.posLine },
  chipText: { fontFamily: font.medium, fontSize: 13, color: color.neutral800 },
  chipTextOn: { color: color.pos },
  chipInput: { minWidth: 90, fontFamily: font.medium, fontSize: 13, color: color.text, paddingVertical: 0 },
  group: { borderRadius: radius.panel, backgroundColor: "#121714", overflow: "hidden" },
  choice: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: 14 },
  choiceLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.neutral300 },
  choiceTitle: { fontFamily: font.medium, fontSize: text.body + 1, color: color.text },
  choiceDetail: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: color.neutral500, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: color.pos, backgroundColor: color.pos },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#183127" },
  inviteHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: space[6], marginBottom: space[3] },
  inviteRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  stack: { flexDirection: "row", alignItems: "center" },
  stackItem: { borderRadius: 19, borderWidth: 2, borderColor: color.bg },
  more: { fontFamily: font.medium, fontSize: 12, color: color.neutral700, marginLeft: 6 },
  addPeople: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: "#151a17" },
  addPeopleText: { fontFamily: font.medium, fontSize: 13, color: color.text },
  problem: { fontFamily: font.regular, fontSize: text.ui, color: color.neg, marginTop: space[4] },
  foot: { paddingHorizontal: space[4], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.divider },
});
