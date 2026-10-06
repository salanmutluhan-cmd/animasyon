// Elora uygulaması için evcil hayvan ekranı (tam ekran pencere içinde WebView).
// Hayvanla konuşurken verilen cevaplar (şikayet, ağrı, ilaç) onLog ile uygulamaya döner
// ve o günün takvim kaydına eklenir. Elle giriş de aynen çalışmaya devam eder.
import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, Platform, StatusBar } from "react-native";
import { WebView } from "react-native-webview";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import petHtml from "./pet/petHtml";

const PET_KEY = "pet-state";

/**
 * Props:
 *  visible, onClose
 *  cycle:       { phase: 'period'|'pms'|'follicular'|'ovulation'|'luteal'|null, day, daysUntilNext }
 *  symptoms:    hazır şikayetler (settings.presetNotes)
 *  medications: hazır ilaçlar (settings.presetMedications)
 *  today:       { date: 'YYYY-MM-DD', symptoms: [...], pain: 7|null, medications: [...], mood: 'sad'|null }  (bugün zaten girilmiş olanlar)
 *  onLog(e):    e = { kind: 'mood'|'symptom'|'pain'|'medication', date, value, custom }
 */
export default function PetScreen({ visible, onClose, cycle, symptoms, medications, today, onLog, title = "Pati dostum" }) {
  const web = useRef(null);
  const ready = useRef(false);
  const [saved, setSaved] = useState(undefined); // undefined: kayıt okunuyor
  const latest = useRef({});
  latest.current = { cycle, symptoms, medications, today, onLog };

  useEffect(() => {
    AsyncStorage.getItem(PET_KEY)
      .then((raw) => setSaved(raw ? JSON.parse(raw) : null))
      .catch(() => setSaved(null));
  }, []);
  useEffect(() => { if (!visible) ready.current = false; }, [visible]);

  const send = (cmd) => {
    if (!web.current || !ready.current) return;
    web.current.injectJavaScript(`window.petCommand && window.petCommand(${JSON.stringify(JSON.stringify(cmd))}); true;`);
  };
  const pushData = () => {
    const L = latest.current;
    send({ type: "cycle", phase: L.cycle?.phase || null, day: L.cycle?.day || 0, daysUntilNext: L.cycle?.daysUntilNext ?? null });
    send({ type: "logOptions", symptoms: L.symptoms || [], medications: L.medications || [], today: L.today });
  };
  // takvimde elle bir şey değişirse hayvan da bilsin (aynı şeyi tekrar sormaz)
  useEffect(() => { pushData(); }, [JSON.stringify([cycle, symptoms, medications, today])]);

  const onMessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!msg || msg.source !== "pet") return;
    const d = msg.data;
    switch (msg.type) {
      case "ready":
        ready.current = true;
        if (saved) send({ type: "setState", state: saved });
        pushData();
        break;
      case "stats":
      case "state":
        AsyncStorage.setItem(PET_KEY, JSON.stringify(d)).catch(() => {});
        break;
      case "log":
        latest.current.onLog && latest.current.onLog(d);
        break;
    }
  };

  const close = () => { send({ type: "getState" }); setTimeout(onClose, 120); };

  return (
    <Modal visible={visible && saved !== undefined} animationType="slide" onRequestClose={close} statusBarTranslucent={false}>
      <View style={{ flex: 1, backgroundColor: "#FFF3EC" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16,
          paddingTop: Platform.OS === "ios" ? 50 : (StatusBar.currentHeight || 0) + 8, paddingBottom: 8, backgroundColor: "#FFF3EC" }}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: "#8E5E55" }}>{title}</Text>
          <TouchableOpacity onPress={close} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "#F6DCE3", alignItems: "center", justifyContent: "center" }}>
            <MaterialCommunityIcons name="close" size={20} color="#8E5E55" />
          </TouchableOpacity>
        </View>
        {visible && saved !== undefined && (
          <WebView
            ref={web}
            originWhitelist={["*"]}
            source={{ html: petHtml }}
            onMessage={onMessage}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            keyboardDisplayRequiresUserAction={false}
            mediaPlaybackRequiresUserAction={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1, backgroundColor: "transparent" }}
            containerStyle={{ backgroundColor: "transparent" }}
          />
        )}
      </View>
    </Modal>
  );
}

// Uygulamanın döngü bilgisinden hayvanın anlayacağı evreyi çıkarır.
// info: useCycleInfo() sonucu, isPeriodToday ve getPhase() ile birlikte kullanılır.
export function petCycleFrom({ info, phaseName, isPeriodToday, periodDayIndex, pregnancyActive }) {
  if (pregnancyActive || !info || !info.hasData) return { phase: null, day: 0, daysUntilNext: null };
  let phase = null;
  if (isPeriodToday) phase = "period";
  else if (phaseName === "luteal" && info.daysUntilNext != null && info.daysUntilNext > 0 && info.daysUntilNext <= 5) phase = "pms";
  else if (phaseName === "ovulation") phase = "ovulation";
  else if (phaseName === "luteal") phase = "luteal";
  else phase = "follicular";
  return { phase, day: isPeriodToday ? periodDayIndex : 0, daysUntilNext: info.daysUntilNext };
}
