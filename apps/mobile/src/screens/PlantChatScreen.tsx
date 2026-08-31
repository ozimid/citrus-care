import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalEngine } from "../components/LocalEngineProvider";
import { LocalEngineSetupCard } from "../components/LocalEngineSetupCard";
import type { ChatMessage } from "../lib/chat-store";
import { newLocalId } from "../lib/local-id";
import {
  buildPlantChatFacts,
  friendlyChatError,
  historyForNextTurn,
  normalizeQuestion,
  runPlantChatTurn,
  unaskedSuggestions,
  type PlantChatFacts,
} from "../lib/plant-chat";
import { appendChatMessage, loadPlantChat } from "../lib/plant-chat-io";
import { fetchPlantDetail } from "../lib/plants-io";
import { getWateringLog } from "../lib/watering-io";
import { cachedLocalConditions } from "../lib/weather-io";
import { RADIUS } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

// F38 "Ask about this plant" — a conversation with the on-device model about
// ONE plant. Everything that makes an answer specific (its care profile, its
// last assessment, its species pruning rules, when it was last watered) is
// assembled by plant-chat-io and rebuilt into the prompt on every question,
// because the local session is stateless per call.
//
// The screen owns what is on screen; the store is best-effort behind it. That
// is why a failed save never removes a bubble, and why the question stays
// visible when the answer fails — the user asked it, so it happened.

const LOAD_ERROR = "Couldn't open the chat for this plant. Close and try again.";
const THINKING = "Thinking on this phone — about half a minute…";
// Not "the first answer takes longer": that is false by the fourth question,
// and the rest of the app's copy does not say things that stop being true.
const SLOW = "Still thinking. This one is taking longer than usual.";
const DISCLAIMER =
  "It only knows what is on this phone. It can't see the plant right now — check it yourself before you cut, spray or feed.";

interface Props {
  plantId: string;
  plantName: string;
  onClose: () => void;
}

export function PlantChatScreen({ plantId, plantName, onClose }: Props) {
  const { t } = useTheme();
  const localEngine = useLocalEngine();
  const scrollRef = useRef<ScrollView>(null);
  const [facts, setFacts] = useState<PlantChatFacts | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  /** A failure belongs to the question that caused it, not to the screen. */
  const [failed, setFailed] = useState<{ question: string; message: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const engineReady = localEngine.state.kind === "ready";
  /** null = follow the conversation (open while empty, collapsed once talking). */
  const [knowsOpen, setKnowsOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Read the stores, then hand them to the pure facts builder — the same
    // fetch → pure-mapper shape the detail screen uses.
    (async () => {
      const now = new Date();
      const [detail, log, history] = await Promise.all([
        fetchPlantDetail(plantId),
        getWateringLog(),
        loadPlantChat(plantId),
      ]);
      const { weather, hemisphere } = await cachedLocalConditions(detail.plant.zip_code, now);
      if (cancelled) return;
      setFacts(
        buildPlantChatFacts({
          plant: detail.plant,
          timeline: detail.timeline,
          log,
          weather,
          now,
          hemisphere: hemisphere ?? undefined,
        }),
      );
      setMessages(history);
    })().catch((e) => {
      console.error("[PlantChatScreen] load failed:", (e as Error).message);
      if (!cancelled) setLoadError(LOAD_ERROR);
    });
    return () => {
      cancelled = true;
    };
  }, [plantId]);

  const ask = useCallback(
    async (raw: string) => {
      const normalized = normalizeQuestion(raw);
      if (!normalized || busy || !facts) return;
      setQuestion("");
      setFailed(null);
      setSlow(false);
      setBusy(true);
      // Optimistic: the bubble is the record of what was asked, whether or not
      // the answer or the store write lands.
      const asked = localMessage(plantId, "user", normalized);
      const history = historyForNextTurn(messages);
      setMessages((current) => [...current, asked]);
      try {
        const answer = await runPlantChatTurn(
          {
            isReady: localEngine.isReady,
            generate: localEngine.generate,
            save: appendChatMessage,
            interrupt: localEngine.interrupt,
          },
          { plantId, facts, history, question: normalized },
          { onSlow: () => setSlow(true) },
        );
        setMessages((current) => [...current, localMessage(plantId, "assistant", answer)]);
      } catch (e) {
        // Details were logged where they happened; only the friendly string
        // shows — attached to the question it belongs to, with the retry next
        // to it. Refilling the composer as well would let one tap send the
        // same question twice.
        setFailed({ question: normalized, message: friendlyChatError(e) });
      } finally {
        setBusy(false);
        setSlow(false);
      }
    },
    [busy, facts, localEngine, messages, plantId],
  );

  // Kept past the first exchange, minus anything already asked: when a question
  // costs 30 seconds, a recognisable follow-up is worth more than a typed guess.
  const suggestions = facts && !busy ? unaskedSuggestions(facts, messages) : [];

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: t.canvas }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to plant"
          onPress={onClose}
          hitSlop={10}
          style={[styles.back, { borderColor: t.border, backgroundColor: t.card }]}
        >
          <Text style={[styles.backGlyph, { color: t.text }]}>‹</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.heading, { color: t.text }]} numberOfLines={1}>
            Ask about {plantName}
          </Text>
          {/* This sentence IS the product — it must not truncate mid-claim. */}
          <Text style={[styles.sub, { color: t.sub }]} numberOfLines={2}>
            Answered on this phone, from this plant's record
          </Text>
        </View>
      </View>

      {loadError ? <Text style={[styles.error, { color: t.danger }]}>{loadError}</Text> : null}

      {/* The record itself, not a claim about it. Three jobs: it makes the
          product's central promise checkable instead of asserted, it gives the
          user something to audit an answer against, and it means the screen
          still says something true when the model is unavailable or returns
          nothing — the same reason PruneScreen renders its sourced rules
          whether or not a mark survives. Every value is already loaded. */}
      {facts ? (
        <KnowsStrip
          facts={facts}
          open={knowsOpen ?? messages.length === 0}
          onToggle={() => setKnowsOpen(!(knowsOpen ?? messages.length === 0))}
          t={t}
        />
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {facts === null && !loadError ? (
          <ActivityIndicator color={t.green} style={styles.loading} />
        ) : null}

        {/* Renders nothing once the model is ready. Without it, the only route
            out of "AI isn't set up" is a sentence pointing at a tab the user
            cannot reach from inside this modal — the end-of-funnel error the
            setup card was built to kill. */}
        <LocalEngineSetupCard />

        {messages.length === 0 && facts ? (
          <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={[styles.emptyTitle, { color: t.text }]}>
              Ask anything about {facts.name}
            </Text>
            {/* What it knows is shown above, not claimed here. Spend this on
                the thing nothing else tells the user: what a question costs. */}
            <Text style={[styles.emptyBody, { color: t.sub }]}>
              Answers are written on this phone, so each one takes about half a minute. Ask one
              question at a time.
            </Text>
          </View>
        ) : null}

        {messages.map((message) => (
          <Bubble key={message.id} message={message} t={t} />
        ))}

        {busy ? (
          <View
            accessibilityLiveRegion="polite"
            accessibilityLabel={slow ? SLOW : THINKING}
            style={[styles.bubble, styles.assistant, { backgroundColor: t.card, borderColor: t.border }]}
          >
            <View style={styles.thinking}>
              <ActivityIndicator color={t.sub} size="small" />
              <Text style={[styles.bubbleText, { color: t.sub }]}>{slow ? SLOW : THINKING}</Text>
            </View>
          </View>
        ) : null}

        {failed ? (
          <View style={styles.failed} accessibilityLiveRegion="assertive">
            <Text style={[styles.error, { color: t.danger }]}>{failed.message}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Ask that question again"
              onPress={() => {
                // Drop the unanswered bubble first; ask() re-adds it.
                setMessages((current) =>
                  current.length > 0 && current[current.length - 1].role === "user"
                    ? current.slice(0, -1)
                    : current,
                );
                void ask(failed.question);
              }}
              style={[styles.retry, { borderColor: t.green }]}
            >
              <Text style={[styles.retryText, { color: t.green }]}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {suggestions.length > 0 ? (
          <View style={styles.suggestions}>
            {suggestions.map((suggestion) => (
              <Pressable
                key={suggestion}
                accessibilityRole="button"
                accessibilityLabel={`Ask: ${suggestion}`}
                onPress={() => ask(suggestion)}
                style={[styles.chip, { borderColor: t.border, backgroundColor: t.card }]}
              >
                <Text style={[styles.chipText, { color: t.text }]}>{suggestion}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={[styles.disclaimer, { color: t.sub }]}>{DISCLAIMER}</Text>
      </ScrollView>

      <View style={[styles.composer, { borderTopColor: t.border, backgroundColor: t.canvas }]}>
        <TextInput
          accessibilityLabel="Your question"
          value={question}
          onChangeText={setQuestion}
          placeholder={engineReady ? `Ask about ${plantName}…` : "Set up the on-device AI above to ask"}
          placeholderTextColor={t.sub}
          multiline
          editable={!busy && facts !== null && engineReady}
          style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send question"
          disabled={busy || facts === null || !engineReady || normalizeQuestion(question) === null}
          onPress={() => ask(question)}
          style={[
            styles.send,
            {
              backgroundColor: t.green,
              opacity: busy || !engineReady || normalizeQuestion(question) === null ? 0.45 : 1,
            },
          ]}
        >
          <Text style={[styles.sendText, { color: t.onGreen }]}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** The plant's own record, in the user's words. Collapsible because it earns
 * its space in the empty state and stops earning it at message ten. */
function KnowsStrip({
  facts,
  open,
  onToggle,
  t,
}: {
  facts: PlantChatFacts;
  open: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useTheme>["t"];
}) {
  const profile = facts.careProfile;
  return (
    <View style={styles.knowsWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`What it knows about ${facts.name}`}
        onPress={onToggle}
        style={[styles.knowsHead, { backgroundColor: t.card, borderColor: t.border }]}
      >
        <Text style={[styles.knowsTitle, { color: t.sub }]} numberOfLines={1}>
          WHAT IT KNOWS ABOUT {facts.name.toUpperCase()}
        </Text>
        <Text style={[styles.knowsChevron, { color: t.sub }]}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open ? (
        <View style={[styles.knowsBody, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.knowsLine, { color: t.text }]}>
            {facts.latest
              ? `Health ${facts.latest.score}/100 · assessed ${facts.latest.dateLabel}` +
                (facts.latest.trend ? ` · ${facts.latest.trend.toLowerCase()} than before` : "")
              : "Not assessed yet — no photo to go on."}
          </Text>
          {facts.latest && facts.latest.symptoms.length > 0 ? (
            <Text style={[styles.knowsLine, { color: t.text }]}>
              Symptoms seen: {facts.latest.symptoms.slice(0, 3).join(", ")}
            </Text>
          ) : null}
          <Text style={[styles.knowsLine, { color: t.text }]}>
            {profile
              ? `Water every ${profile.base_watering_interval_days} days` +
                (facts.lastWateredLabel ? ` · last watered ${facts.lastWateredLabel}` : "") +
                (facts.nextWaterLabel ? ` · ${facts.nextWaterLabel.toLowerCase()}` : "")
              : "No care baseline yet."}
          </Text>
          {facts.careRules[0] ? (
            <Text style={[styles.knowsLine, { color: t.text }]}>{facts.careRules[0]}</Text>
          ) : null}
          {facts.quarantineNote ? (
            <Text style={[styles.knowsLine, { color: t.danger }]}>
              In an active citrus quarantine zone — moving clippings off the property is restricted.
            </Text>
          ) : null}
          <Text style={[styles.knowsFoot, { color: t.sub }]}>
            That is the whole of it. No internet, no other plants, nothing sent anywhere.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** A bubble that exists on screen before (or without) a store write. */
function localMessage(plantId: string, role: "user" | "assistant", text: string): ChatMessage {
  return {
    id: newLocalId(Date.now(), Math.random()),
    plantId,
    role,
    text,
    createdAt: new Date().toISOString(),
  };
}

function Bubble({ message, t }: { message: ChatMessage; t: ReturnType<typeof useTheme>["t"] }) {
  const mine = message.role === "user";
  return (
    <View
      accessibilityLabel={`${mine ? "You asked" : "Answer"}: ${message.text}`}
      style={[
        styles.bubble,
        mine ? styles.mine : styles.assistant,
        mine
          ? { backgroundColor: t.green }
          : { backgroundColor: t.card, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Text style={[styles.bubbleText, { color: mine ? t.onGreen : t.text }]}>{message.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 68 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, marginBottom: 8 },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  backGlyph: { fontSize: 22, fontWeight: "600", marginTop: -2 },
  headerText: { flex: 1, gap: 2 },
  heading: { fontSize: 20, fontWeight: "600", letterSpacing: -0.3 },
  sub: { fontSize: 12 },
  scroll: { paddingHorizontal: 20, paddingBottom: 20, gap: 10 },
  knowsWrap: { paddingHorizontal: 20, marginBottom: 8 },
  knowsHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
  },
  knowsTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, flexShrink: 1 },
  knowsChevron: { fontSize: 14 },
  knowsBody: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS,
    marginTop: 6,
    padding: 14,
    gap: 5,
  },
  knowsLine: { fontSize: 13, lineHeight: 19 },
  knowsFoot: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  loading: { marginTop: 40 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS, padding: 14, gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyBody: { fontSize: 13, lineHeight: 19 },
  bubble: { borderRadius: RADIUS + 4, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "88%" },
  mine: { alignSelf: "flex-end", borderBottomRightRadius: 4 },
  assistant: { alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  thinking: { flexDirection: "row", alignItems: "center", gap: 8 },
  error: { fontSize: 13, paddingHorizontal: 4 },
  suggestions: { gap: 8, marginTop: 4 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: "center",
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  disclaimer: { fontSize: 11, lineHeight: 16, marginTop: 8 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    maxHeight: 120,
  },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  failed: { gap: 8, alignSelf: "flex-start", maxWidth: "88%" },
  retry: {
    borderWidth: 1,
    borderRadius: RADIUS,
    minHeight: 48,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { fontSize: 15, fontWeight: "600" },
  sendText: { fontSize: 20, fontWeight: "700" },
});
