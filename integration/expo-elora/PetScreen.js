// Elora uygulaması için evcil hayvan ekranı (tam ekran pencere içinde WebView).
// Hayvanla konuşurken verilen cevaplar (şikayet, ağrı, ilaç) onLog ile uygulamaya döner
// ve o günün takvim kaydına eklenir. Elle giriş de aynen çalışmaya devam eder.
import React, { useEffect, useRef } from "react";
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
 *  onRewardedAd(): Promise<boolean>  ödüllü reklamı gösterir; sonuna kadar izlendiyse true
 *  onInterstitial(): hayvan ya da ismi değiştirilince geçiş reklamı
 *  banner:      ekranın altında gösterilecek banner reklam (React öğesi)
 */
export default function PetScreen({ visible, onClose, cycle, symptoms, medications, today, onLog, onRewardedAd, onInterstitial, banner, title = "Pati dostum" }) {
  const web = useRef(null);
  const ready = useRef(false);
  const lastState = useRef(null); // hayvanın en son durumu (para, seviye, kıyafet…)
  const restored = useRef(false);
  const latest = useRef({});
  latest.current = { cycle, symptoms, medications, today, onLog, onRewardedAd, onInterstitial };

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
      case "ready": {
        ready.current = true; restored.current = false;
        // her açılışta kayıt yeniden okunur (eskiden ilk açılıştaki kayıt kalıyordu, para ve seviye sıfırlanıyordu)
        const restore = (st) => { send({ type: "setState", state: st || {} }); restored.current = true; pushData(); };
        if (lastState.current) restore(lastState.current);
        else AsyncStorage.getItem(PET_KEY).then((raw) => restore(raw ? JSON.parse(raw) : null)).catch(() => restore(null));
        break;
      }
      case "stats":
      case "state":
        if (!restored.current) break; // kayıt geri yüklenmeden gelen boş durum kaydın üzerine yazılmasın
        lastState.current = d;
        AsyncStorage.setItem(PET_KEY, JSON.stringify(d)).catch(() => {});
        break;
      case "log":
        latest.current.onLog && latest.current.onLog(d);
        break;
      case "adRequest": { // reklam izle → pati parası
        const fn = latest.current.onRewardedAd;
        Promise.resolve(fn ? fn() : false).then((ok) => send({ type: ok ? "adReward" : "adFailed" })).catch(() => send({ type: "adFailed" }));
        break;
      }
      case "interstitial":
        latest.current.onInterstitial && latest.current.onInterstitial();
        break;
    }
  };

  const close = () => { send({ type: "getState" }); setTimeout(onClose, 150); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent={false}>
      <View style={{ flex: 1, backgroundColor: "#FFF3EC" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16,
          paddingTop: Platform.OS === "ios" ? 50 : (StatusBar.currentHeight || 0) + 8, paddingBottom: 8, backgroundColor: "#FFF3EC" }}>
          <Text style={{ fontSize: 17, fontWeight: "800", color: "#8E5E55" }}>{title}</Text>
          <TouchableOpacity onPress={close} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: "#F6DCE3", alignItems: "center", justifyContent: "center" }}>
            <MaterialCommunityIcons name="close" size={20} color="#8E5E55" />
          </TouchableOpacity>
        </View>
        {visible && (
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
            allowsInlineMediaPlayback
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1, backgroundColor: "transparent" }}
            containerStyle={{ backgroundColor: "transparent" }}
          />
        )}
        {banner ? <View style={{ alignItems: "center", justifyContent: "center", backgroundColor: "#FFF3EC", minHeight: 50, paddingBottom: Platform.OS === "ios" ? 18 : 0 }}>{banner}</View> : null}
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
