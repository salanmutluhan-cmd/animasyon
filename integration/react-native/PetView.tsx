// React Native / Expo bileşeni
// Gerekli paket:  npx expo install react-native-webview   (ya da)  npm i react-native-webview
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import petHtml from './petHtml';

export type Species = 'dog' | 'cat';
export type Mood = 'happy' | 'neutral' | 'hungry' | 'thirsty' | 'tired' | 'dirty' | 'sad' | 'sleeping';

export interface PetStats { fullness: number; hydration: number; energy: number; happiness: number; cleanliness: number; }
export interface PetState { species: Species; breed: string; eyes: string | null; stats: PetStats; sleeping: boolean; mood: Mood | null; lastUpdate: number; }

export interface PetViewHandle {
  feed(): void;
  feedTreat(): void;
  bathe(): void;
  throwBall(): void;
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
