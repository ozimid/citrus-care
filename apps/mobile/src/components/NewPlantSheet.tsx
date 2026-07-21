import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CITRUS_CULTIVARS, PLANT_TYPES } from "@citrus/shared";
import {
  emptyNewPlantForm,
  formFromPlant,
  GENERIC_CREATE_PLANT_ERROR,
  showsCitrusCultivarPicker,
  validateNewPlant,
  type NewPlantFieldErrors,
  type NewPlantForm,
} from "../lib/new-plant";
import { GENERIC_UPDATE_PLANT_ERROR } from "../lib/plant-mutations";
import { insertPlant, updatePlant } from "../lib/plants-io";
import { RADIUS, type Tokens } from "../lib/theme";
import { useTheme } from "../lib/theme-io";

// New/edit plant bottom sheet per the native design doc §4 (#5/#7): same
// fields and validation as the web form (apps/web/app/plants/new/
// new-plant-form.tsx) — name required, citrus cultivar list only for trees,
// everything else optional. Passing `plant` flips the sheet into edit mode
// (prefilled values, "Save changes", update instead of insert). All logic
// lives in src/lib/new-plant.ts + plant-mutations.ts (tested); this file is
// only the sheet UI.

interface EditablePlant {
  id: string;
  name: string;
  plant_type: string;
  species: string | null;
  cultivar: string | null;
  location: string | null;
  zip_code: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called after a successful insert/update — parent refreshes and closes.
   * Receives the plant id + name (F35's deferred assess needs them). */
  onSaved: (plantId: string, name: string) => void;
  /** Edit mode: prefill from this plant and update it on submit. */
  plant?: EditablePlant | null;
  /** F35 snap-first: draft values from the AI's plant_guess (create mode
   * only). The user always reviews before saving. */
  prefill?: Partial<NewPlantForm> | null;
}

export function NewPlantSheet({ visible, onClose, onSaved, plant, prefill }: Props) {
  const { t } = useTheme();
  const [form, setForm] = useState<NewPlantForm>(emptyNewPlantForm);
  const [errors, setErrors] = useState<NewPlantFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cultivarOpen, setCultivarOpen] = useState(false);
  const editing = plant != null;

  // Edit mode: re-prefill from the plant row on every open, discarding
  // unsaved edits. (Create mode keeps typed values across an accidental
  // close, as before; submit resets them on success.)
  useEffect(() => {
    if (!visible || !plant) return;
    setForm(formFromPlant(plant));
    setErrors({});
    setSubmitError(null);
    setCultivarOpen(false);
  }, [visible, plant]);

  // F35: AI-drafted create mode — merge the guess over an empty form on open.
  useEffect(() => {
    if (!visible || plant || !prefill) return;
    setForm({ ...emptyNewPlantForm, ...prefill });
    setErrors({});
    setSubmitError(null);
  }, [visible, plant, prefill]);

  const set = (field: keyof NewPlantForm, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const close = () => {
    setErrors({});
    setSubmitError(null);
    setCultivarOpen(false);
    onClose();
  };

  const submit = async () => {
    const result = validateNewPlant(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setBusy(true);
    try {
      let savedId: string;
      if (plant) {
        await updatePlant(plant.id, result.data);
        savedId = plant.id;
      } else {
        savedId = await insertPlant(result.data);
        // F20: the plant is created without a care profile. It is generated
        // on-device, opportunistically, when the detail screen's watering card
        // finds the model ready — so adding a plant never waits on the model.
        setForm(emptyNewPlantForm);
      }
      setCultivarOpen(false);
      onSaved(savedId, result.data.name);
    } catch {
      // insertPlant/updatePlant already logged details; generic message only.
      setSubmitError(editing ? GENERIC_UPDATE_PLANT_ERROR : GENERIC_CREATE_PLANT_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const citrusPicker = showsCitrusCultivarPicker(form.plant_type);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close" style={styles.backdropTouch} onPress={close} />
        {/* "padding" on BOTH platforms: inside an RN Modal Android never gets
            the window's adjustResize, so an undefined behavior left the lower
            fields (ZIP code) hidden under the keyboard (feedback 2026-07-16). */}
        <KeyboardAvoidingView behavior="padding">
          <View style={[styles.sheet, { backgroundColor: t.card }]}>
            <View style={styles.header}>
              <Text style={[styles.title, { color: t.text }]}>
                {editing ? "Edit plant" : "New plant"}
              </Text>
              <Pressable accessibilityRole="button" onPress={close} hitSlop={10}>
                <Text style={[styles.cancel, { color: t.sub }]}>Cancel</Text>
              </Pressable>
            </View>
            {!editing && prefill ? (
              <Text style={[styles.prefillNote, { color: t.sub }]}>
                ✨ AI filled this in from the photo — check it and adjust.
              </Text>
            ) : null}
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
            >
              <Field label="Name" error={errors.name} t={t}>
                <TextInput
                  accessibilityLabel="Name"
                  value={form.name}
                  onChangeText={(v) => set("name", v)}
                  maxLength={80}
                  placeholder="e.g. Mr Lemon by the door"
                  placeholderTextColor={t.sub}
                  style={[inputStyle(t), errors.name ? { borderColor: t.danger } : null]}
                />
              </Field>

              <Field label="Plant type" error={errors.plant_type} t={t}>
                <View style={styles.chips}>
                  {PLANT_TYPES.map((type) => {
                    const selected = form.plant_type === type;
                    return (
                      <Pressable
                        key={type}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => {
                          // Entering tree mode swaps the free-text cultivar for
                          // the citrus list; drop a value the list doesn't have.
                          setForm((f) => ({
                            ...f,
                            plant_type: type,
                            cultivar:
                              showsCitrusCultivarPicker(type) &&
                              !CITRUS_CULTIVARS.includes(
                                f.cultivar as (typeof CITRUS_CULTIVARS)[number],
                              )
                                ? ""
                                : f.cultivar,
                          }));
                          setCultivarOpen(false);
                        }}
                        style={[
                          styles.chip,
                          {
                            borderColor: selected ? t.green : t.border,
                            backgroundColor: selected ? t.green : "transparent",
                          },
                        ]}
                      >
                        <Text
                          style={[styles.chipText, { color: selected ? t.onGreen : t.text }]}
                        >
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>

              <Field label="Species" error={errors.species} t={t}>
                <TextInput
                  accessibilityLabel="Species"
                  value={form.species}
                  onChangeText={(v) => set("species", v)}
                  maxLength={80}
                  placeholder="e.g. Citrus limon (optional)"
                  placeholderTextColor={t.sub}
                  style={inputStyle(t)}
                />
              </Field>

              {citrusPicker ? (
                <Field label="Cultivar (Citrus)" error={errors.cultivar} t={t}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cultivar"
                    onPress={() => setCultivarOpen((open) => !open)}
                    style={inputStyle(t)}
                  >
                    <Text style={{ color: form.cultivar ? t.text : t.sub, fontSize: 15 }}>
                      {form.cultivar || "Select (optional)"}
                    </Text>
                  </Pressable>
                  {cultivarOpen ? (
                    <ScrollView
                      style={[styles.options, { borderColor: t.border, backgroundColor: t.card }]}
                      nestedScrollEnabled
                    >
                      <OptionRow
                        label="None"
                        selected={form.cultivar === ""}
                        t={t}
                        onPress={() => {
                          set("cultivar", "");
                          setCultivarOpen(false);
                        }}
                      />
                      {CITRUS_CULTIVARS.map((c) => (
                        <OptionRow
                          key={c}
                          label={c}
                          selected={form.cultivar === c}
                          t={t}
                          onPress={() => {
                            set("cultivar", c);
                            setCultivarOpen(false);
                          }}
                        />
                      ))}
                    </ScrollView>
                  ) : null}
                </Field>
              ) : (
                <Field label="Cultivar / Variety" error={errors.cultivar} t={t}>
                  <TextInput
                    accessibilityLabel="Cultivar"
                    value={form.cultivar}
                    onChangeText={(v) => set("cultivar", v)}
                    maxLength={60}
                    placeholder="e.g. Knock Out, Haas (optional)"
                    placeholderTextColor={t.sub}
                    style={inputStyle(t)}
                  />
                </Field>
              )}

              <Field label="Location" error={errors.location} t={t}>
                <TextInput
                  accessibilityLabel="Location"
                  value={form.location}
                  onChangeText={(v) => set("location", v)}
                  maxLength={80}
                  placeholder="e.g. South patio (optional)"
                  placeholderTextColor={t.sub}
                  style={inputStyle(t)}
                />
              </Field>

              <Field label="ZIP code" error={errors.zip_code} t={t}>
                <TextInput
                  accessibilityLabel="ZIP code"
                  value={form.zip_code}
                  onChangeText={(v) => set("zip_code", v)}
                  maxLength={5}
                  keyboardType="number-pad"
                  placeholder="e.g. 90210 (optional)"
                  placeholderTextColor={t.sub}
                  style={[inputStyle(t), errors.zip_code ? { borderColor: t.danger } : null]}
                />
              </Field>

              {submitError ? (
                <Text accessibilityRole="alert" style={[styles.submitError, { color: t.danger }]}>
                  {submitError}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={editing ? "Save changes" : "Add plant"}
                disabled={busy}
                onPress={submit}
                style={[styles.submit, { backgroundColor: t.green, opacity: busy ? 0.6 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator color={t.onGreen} />
                ) : (
                  <Text style={[styles.submitText, { color: t.onGreen }]}>
                    {editing ? "Save changes" : "Add plant"}
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Field({
  label,
  error,
  t,
  children,
}: {
  label: string;
  error?: string;
  t: Tokens;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: t.sub }]}>{label}</Text>
      {children}
      {error ? <Text style={[styles.fieldError, { color: t.danger }]}>{error}</Text> : null}
    </View>
  );
}

function OptionRow({
  label,
  selected,
  t,
  onPress,
}: {
  label: string;
  selected: boolean;
  t: Tokens;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.option, { borderBottomColor: t.border }]}
    >
      <Text style={{ color: selected ? t.green : t.text, fontSize: 15 }}>{label}</Text>
      {selected ? <Text style={{ color: t.green }}>✓</Text> : null}
    </Pressable>
  );
}

function inputStyle(t: Tokens) {
  return {
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: RADIUS,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: t.text,
    minHeight: 44,
    justifyContent: "center" as const,
  };
}

const styles = StyleSheet.create({
  prefillNote: { fontSize: 13, marginBottom: 8 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  backdropTouch: { flex: 1 },
  sheet: {
    borderTopLeftRadius: RADIUS + 6,
    borderTopRightRadius: RADIUS + 6,
    paddingTop: 18,
    maxHeight: "100%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  title: { fontSize: 19, fontWeight: "600", letterSpacing: -0.3 },
  cancel: { fontSize: 15, fontWeight: "500" },
  body: { paddingHorizontal: 20, paddingBottom: 34, gap: 14, paddingTop: 8 },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  fieldError: { fontSize: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  options: {
    borderWidth: 1,
    borderRadius: RADIUS,
    maxHeight: 200,
  },
  option: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  submitError: { fontSize: 13 },
  submit: {
    borderRadius: RADIUS,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitText: { fontSize: 16, fontWeight: "600" },
});
