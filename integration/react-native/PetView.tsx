// React Native / Expo bileşeni
// Gerekli paket:  npx expo install react-native-webview   (ya da)  npm i react-native-webview
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import petHtml from './petHtml';

export type Species = 'dog' | 'cat';
export type Mood = 'happy' | 'neutral' | 'hungry' | 'thirsty' | 'tired' | 'dirty' | 'sad' | 'sick' | 'sleeping';

export interface PetStats { fullness: number; hydration: number; energy: number; happiness: number; cleanliness: number; health: number; }
export type CyclePhase = 'period' | 'pms' | 'follicular' | 'ovulation' | 'luteal';
export type UserMood = 'happy' | 'sad' | 'tired' | 'pain' | 'angry' | 'anxious';
export interface PetState { species: Species; breed: string; eyes: string | null; stats: PetStats; sleeping: boolean; mood: Mood | null; lastUpdate: number; }

export interface PetViewHandle {
  feed(): void;
  feedTreat(): void;
  bathe(): void;
  throwBall(): void;
  /** 'kibble' | 'meat' | 'treat' | 'veggie' | 'milk' | 'cake' */
  feedFood(food: string): void;
  /** false → ışık söner, perde kapanır, hayvan uyur */
  setLights(on: boolean): void;
  toggleLights(): void;
  /** 'ball' | 'laser' | 'bubbles' | 'butterfly' */
  startGame(name: string): void;
  stopGame(): void;
  /** banyoya geç / odaya dön (banyoda yemek ve oyun yok) */
  goBath(): void;
  goRoom(): void;
  brushFur(): void;
  brushTeeth(): void;
  /** 'thermo' | 'syrup' | 'vitamin' */
  giveMedicine(id: string): void;
  /** Regl uygulaması: döngü evresi (null → kapalı), day: regl'in kaçıncı günü */
  setCycle(phase: CyclePhase | null, day?: number, daysUntilNext?: number | null): void;
  /** takvimdeki hazır şikayet / ilaç listeleri ve bugün girilenler */
  setLogOptions(o: { symptoms: string[]; medications: string[]; today?: { date: string; symptoms: string[]; pain: number | null; medications: string[] } }): void;
  /** 'checkin' | 'meds' | 'forecast' | 'mood' */
  startTalk(kind?: string): void;
  setUserMood(mood: UserMood): void;
  remindWater(): void;
  /** dakika; 0 → kapalı */
  setWaterReminder(minutes: number): void;
  userDrankWater(): void;
  reward(xp: number, coins: number): void;
  buy(id: string): void;
  wear(id: string): void;
  unwear(slot?: 'head' | 'eyes' | 'neck' | 'body'): void;
  openPanel(name: 'quests' | 'shop' | 'wardrobe' | 'mood' | 'vet'): void;
  say(text: string, seconds?: number): void;
  setName(name: string): void;
  setSound(on: boolean): void;
  setBreed(breed: string): void;
  setEyes(eyes: string | null): void;
  giveWater(): void;
  sleep(): void;
  wake(): void;
  petOnce(): void;
  celebrate(): void;
  yawn(): void;
  play(name: string): void;
  setSpecies(species: Species): void;
  setState(state: Partial<PetState>): void;
  setTimeScale(value: number): void;
  pause(): void;
  resume(): void;
}

interface Props {
  species?: Species;
  /** golden, kangal, dalmatian, husky, bulldog, beagle, pug, labrador, collie, shiba, rottweiler, pomeranian,
   *  tabby, van, ankara, british, siamese, tuxedo, calico, black, silver, mainecoon, scottish */
  breed?: string;
  eyes?: string;
  /** Kaydedilmiş durum (AsyncStorage vb.). lastUpdate verilirse aradan geçen süre uygulanır. */
  initialState?: Partial<PetState>;
  style?: StyleProp<ViewStyle>;
  onReady?(state: PetState): void;
  onStats?(state: PetState): void;   // ~saniyede bir
  onMood?(mood: Mood, previous: Mood | null): void;
  onAction?(name: string, phase: 'start' | 'end'): void;
  onPet?(phase: 'start' | 'end'): void;
  /** Kullanıcı balondaki "İçtim ✓" butonuna bastı */
  onUserDrankWater?(): void;
  /** Hayvanla konuşurken verilen cevap → o günün takvim kaydına ekleyin */
  onLog?(e: { kind: 'symptom' | 'pain' | 'medication'; date: string; value: string | number; custom?: boolean }): void;
  /** Tüm olaylar (level, quest, userMood, buy, med, groom, say …) */
  onEvent?(type: string, data: any): void;
}

export const PetView = forwardRef<PetViewHandle, Props>(function PetView(props, ref) {
  const web = useRef<WebView>(null);

  const send = (cmd: object) => {
    const js = `window.petCommand(${JSON.stringify(JSON.stringify(cmd))}); true;`;
    web.current?.injectJavaScript(js);
  };

  useImperativeHandle(ref, () => ({
    feed: () => send({ type: 'feed' }),
    feedTreat: () => send({ type: 'treat' }),
    bathe: () => send({ type: 'bath' }),
    throwBall: () => send({ type: 'ball' }),
    feedFood: (food: string) => send({ type: 'feedFood', food }),
    setLights: (on: boolean) => send({ type: 'lights', on }),
    toggleLights: () => send({ type: 'toggleLights' }),
    startGame: (name: string) => send({ type: 'game', name }),
    stopGame: () => send({ type: 'stopGame' }),
    goBath: () => send({ type: 'scene', scene: 'bath' }),
    goRoom: () => send({ type: 'scene', scene: 'room' }),
    brushFur: () => send({ type: 'brushFur' }),
    brushTeeth: () => send({ type: 'brushTeeth' }),
    giveMedicine: (id: string) => send({ type: 'medicine', id }),
    setCycle: (phase, day, daysUntilNext) => send({ type: 'cycle', phase, day, daysUntilNext }),
    setLogOptions: (o) => send({ type: 'logOptions', ...o }),
    startTalk: (kind = 'checkin') => send({ type: 'talk', kind }),
    setUserMood: (mood) => send({ type: 'userMood', mood }),
    remindWater: () => send({ type: 'remindWater' }),
    setWaterReminder: (minutes: number) => send({ type: 'waterReminder', minutes }),
    userDrankWater: () => send({ type: 'userDrankWater' }),
    reward: (xp: number, coins: number) => send({ type: 'reward', xp, coins }),
    buy: (id: string) => send({ type: 'buy', id }),
    wear: (id: string) => send({ type: 'wear', id }),
    unwear: (slot) => send({ type: 'unwear', slot }),
    openPanel: (name) => send({ type: 'panel', name }),
    say: (text: string, seconds?: number) => send({ type: 'say', text, duration: seconds }),
    setName: (name: string) => send({ type: 'setName', name }),
    setSound: (on: boolean) => send({ type: 'sound', on }),
    setBreed: (breed) => send({ type: 'setBreed', breed }),
    setEyes: (eyes) => send({ type: 'setEyes', eyes }),
    giveWater: () => send({ type: 'water' }),
    sleep: () => send({ type: 'sleep' }),
    wake: () => send({ type: 'wake' }),
    petOnce: () => send({ type: 'pet' }),
    celebrate: () => send({ type: 'celebrate' }),
    yawn: () => send({ type: 'yawn' }),
    play: (name) => send({ type: 'play', name }),
    setSpecies: (species) => send({ type: 'setSpecies', species }),
    setState: (state) => send({ type: 'setState', state }),
    setTimeScale: (value) => send({ type: 'setTimeScale', value }),
    pause: () => send({ type: 'pause' }),
    resume: () => send({ type: 'resume' }),
  }));

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!msg || msg.source !== 'pet') return;
    const d = msg.data;
    props.onEvent?.(msg.type, d);
    switch (msg.type) {
      case 'ready':
        if (props.breed) send({ type: 'setBreed', breed: props.breed });
        else if (props.species) send({ type: 'setSpecies', species: props.species });
        if (props.eyes) send({ type: 'setEyes', eyes: props.eyes });
        if (props.initialState) send({ type: 'setState', state: props.initialState });
        props.onReady?.(d);
        break;
      case 'stats': props.onStats?.(d); break;
      case 'mood': props.onMood?.(d.mood, d.previous); break;
      case 'action': props.onAction?.(d.name, d.phase); break;
      case 'pet': props.onPet?.(d.phase); break;
      case 'userWater': props.onUserDrankWater?.(); break;
      case 'log': props.onLog?.(d); break;
    }
  };

  return (
    <WebView
      ref={web}
      originWhitelist={['*']}
      source={{ html: petHtml }}
      onMessage={onMessage}
      style={[{ backgroundColor: 'transparent' }, props.style]}
      containerStyle={{ backgroundColor: 'transparent' }}
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      javaScriptEnabled
      androidLayerType="hardware"
    />
  );
});

export default PetView;

/* ----------------------------------------------------------------------------
Örnek kullanım (durumu AsyncStorage ile saklama):

import AsyncStorage from '@react-native-async-storage/async-storage';

function PetScreen() {
  const pet = useRef<PetViewHandle>(null);
  const [saved, setSaved] = useState<PetState | null | undefined>(undefined);
  useEffect(() => { AsyncStorage.getItem('pet').then(s => setSaved(s ? JSON.parse(s) : null)); }, []);
  if (saved === undefined) return null;

  return (
    <View style={{ flex: 1 }}>
      <PetView
        ref={pet}
        species="dog"
        initialState={saved ?? undefined}
        style={{ width: '100%', aspectRatio: 3 / 4 }}
        onStats={s => AsyncStorage.setItem('pet', JSON.stringify(s))}
      />
      <Button title="Besle" onPress={() => pet.current?.feed()} />
      <Button title="Su ver" onPress={() => pet.current?.giveWater()} />
      <Button title="Uyut" onPress={() => pet.current?.sleep()} />
      <Button title="Uyandır" onPress={() => pet.current?.wake()} />
    </View>
  );
}
---------------------------------------------------------------------------- */
