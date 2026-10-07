/**
 * Add people to a new room: search traders by name or handle, tap to add or
 * remove. The room adds them as members when it's created.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { MagnifyingGlassIcon } from "phosphor-react-native/src/icons/MagnifyingGlass";
import { XIcon } from "phosphor-react-native/src/icons/X";
import type { SearchDTO } from "@imo/server/dto/api-types";
import { Avatar } from "~/components/avatar";
import { Button, PRIMARY_INK } from "~/components/button";
import { useMe } from "~/features/auth/use-account";
import { api } from "~/lib/api";
import { color, font, radius, space, text } from "~/theme/tokens";

export type Person = SearchDTO["traders"][number];

interface Props {
  open: boolean;
  added: Person[];
  onChange: (people: Person[]) => void;
  onClose: () => void;
}

export function AddPeopleSheet({ open, added, onChange, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const me = useMe().data;
  const [q, setQ] = useState("");
  const query = q.trim();
  const results = useQuery({
    queryKey: ["search", "people", query],
    queryFn: ({ signal }) => api<SearchDTO>("/search", { query: { q: query }, signal }),
    enabled: open && query.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const people = query.length >= 2 ? (results.data?.traders ?? []).filter((p) => p.handle !== me?.user.handle) : added;
  const isAdded = (p: Person) => added.some((a) => a.handle === p.handle);
  const toggle = (p: Person) => onChange(isAdded(p) ? added.filter((a) => a.handle !== p.handle) : [...added, p].slice(0, 20));

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.anchor}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
          <View style={styles.grip} />
          <View style={styles.head}>
            <Text style={styles.title}>Add people</Text>
            <Pressable onPress={onClose} style={styles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <XIcon size={16} weight="bold" color={color.neutral800} />
            </Pressable>
          </View>
          <View style={styles.search}>
            <MagnifyingGlassIcon size={16} color={color.neutral600} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search by name or @handle"
              placeholderTextColor={color.neutral600}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              style={styles.input}
              accessibilityLabel="Search people"
            />
          </View>
          <FlatList
            data={people}
            keyExtractor={(p) => p.handle}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {query.length < 2
                  ? "Search for traders to add. They join the room as soon as it’s created."
                  : results.isFetching
                    ? "Searching…"
                    : `No one matches “${query}”.`}
              </Text>
            }
            renderItem={({ item }) => {
              const on = isAdded(item);
              return (
                <Pressable
                  onPress={() => toggle(item)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${item.name}, @${item.handle}`}
                >
                  <Avatar url={item.avatarUrl} size={38} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.handle} numberOfLines={1}>
                      @{item.handle}
                    </Text>
                  </View>
                  <View style={[styles.check, on && styles.checkOn]}>{on ? <CheckIcon size={13} weight="bold" color={PRIMARY_INK} /> : null}</View>
                </Pressable>
              );
            }}
          />
          <Button label={added.length ? `Done · ${added.length} added` : "Done"} onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(5, 8, 6, 0.6)" },
  anchor: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "86%",
    gap: space[3],
    paddingHorizontal: space[4],
    paddingTop: space[2],
    borderTopLeftRadius: radius.drawer + 4,
    borderTopRightRadius: radius.drawer + 4,
    backgroundColor: "#0d1210",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: color.neutral400,
  },
  grip: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: color.neutral500 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: space[2] },
  title: { fontFamily: font.medium, fontSize: 20, letterSpacing: -0.4, color: color.text },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: color.neutral300 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, height: 44, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: "#141a17" },
  input: { flex: 1, fontFamily: font.regular, fontSize: text.body, color: color.text },
  list: { minHeight: 180 },
  empty: { fontFamily: font.regular, fontSize: 13, lineHeight: 19, color: color.neutral700, paddingVertical: space[5], textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 10 },
  rowPressed: { opacity: 0.7 },
  name: { fontFamily: font.medium, fontSize: text.body, color: color.text },
  handle: { fontFamily: font.regular, fontSize: 12, color: color.neutral700 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: color.neutral500, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: color.pos, borderColor: color.pos },
});
