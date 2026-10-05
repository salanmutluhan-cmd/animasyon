// Flutter widget'ı
// pubspec.yaml:
//   dependencies:
//     webview_flutter: ^4.8.0
//   flutter:
//     assets:
//       - assets/pet.html        # dist/pet.html dosyasını buraya kopyalayın
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:webview_flutter/webview_flutter.dart';

class PetController {
  WebViewController? _web;

  void _attach(WebViewController c) => _web = c;

  Future<void> send(Map<String, dynamic> cmd) async {
    final arg = jsonEncode(jsonEncode(cmd));
    await _web?.runJavaScript('window.petCommand($arg);');
  }

  Future<void> feed() => send({'type': 'feed'});
  Future<void> feedTreat() => send({'type': 'treat'});
  Future<void> bathe() => send({'type': 'bath'});
  Future<void> throwBall() => send({'type': 'ball'});
  /// kibble, meat, treat, veggie, milk, cake
  Future<void> feedFood(String food) => send({'type': 'feedFood', 'food': food});
  /// false → ışık söner, perde kapanır, hayvan uyur
  Future<void> setLights(bool on) => send({'type': 'lights', 'on': on});
  Future<void> toggleLights() => send({'type': 'toggleLights'});
  /// ball, laser, bubbles, butterfly
  Future<void> startGame(String name) => send({'type': 'game', 'name': name});
  Future<void> stopGame() => send({'type': 'stopGame'});
  /// banyoya geç / odaya dön (banyoda yemek ve oyun yok)
  Future<void> goBath() => send({'type': 'scene', 'scene': 'bath'});
  Future<void> goRoom() => send({'type': 'scene', 'scene': 'room'});
  Future<void> setName(String name) => send({'type': 'setName', 'name': name});
  Future<void> setSound(bool on) => send({'type': 'sound', 'on': on});
  Future<void> setBreed(String breed) => send({'type': 'setBreed', 'breed': breed});
  Future<void> setEyes(String? eyes) => send({'type': 'setEyes', 'eyes': eyes});
  Future<void> giveWater() => send({'type': 'water'});
  Future<void> sleep() => send({'type': 'sleep'});
  Future<void> wake() => send({'type': 'wake'});
  Future<void> petOnce() => send({'type': 'pet'});
  Future<void> celebrate() => send({'type': 'celebrate'});
  Future<void> yawn() => send({'type': 'yawn'});
  Future<void> play(String name) => send({'type': 'play', 'name': name});
  Future<void> setSpecies(String species) => send({'type': 'setSpecies', 'species': species});
  Future<void> setState(Map<String, dynamic> state) => send({'type': 'setState', 'state': state});
  Future<void> setTimeScale(double v) => send({'type': 'setTimeScale', 'value': v});
  Future<void> pause() => send({'type': 'pause'});
  Future<void> resume() => send({'type': 'resume'});
}

class PetView extends StatefulWidget {
  const PetView({
    super.key,
    required this.controller,
    this.species = 'dog',
    this.initialState,
    this.onStats,
    this.onMood,
    this.onAction,
  });

  final PetController controller;
  final String species; // 'dog' | 'cat'
  /// SharedPreferences vb. ile saklanan durum (getState çıktısı). lastUpdate varsa geçen süre uygulanır.
  final Map<String, dynamic>? initialState;
  final void Function(Map<String, dynamic> state)? onStats;
  final void Function(String mood)? onMood;
  final void Function(String name, String phase)? onAction;

  @override
  State<PetView> createState() => _PetViewState();
}

class _PetViewState extends State<PetView> {
  late final WebViewController _web;

  @override
  void initState() {
    super.initState();
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..addJavaScriptChannel('PetBridge', onMessageReceived: _onMessage);
    widget.controller._attach(_web);
    _load();
  }

  Future<void> _load() async {
    final html = await rootBundle.loadString('assets/pet.html');
    await _web.loadHtmlString(html);
  }

  void _onMessage(JavaScriptMessage m) {
    final msg = jsonDecode(m.message);
    if (msg is! Map || msg['source'] != 'pet') return;
    final data = msg['data'];
    switch (msg['type']) {
      case 'ready':
        widget.controller.setSpecies(widget.species);
        if (widget.initialState != null) widget.controller.setState(widget.initialState!);
        break;
      case 'stats':
        widget.onStats?.call(Map<String, dynamic>.from(data));
        break;
      case 'mood':
        widget.onMood?.call(data['mood']);
        break;
      case 'action':
        widget.onAction?.call(data['name'], data['phase']);
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 3 / 4,
      child: WebViewWidget(controller: _web),
    );
  }
}

/* Örnek:
final pet = PetController();
...
Column(children: [
  PetView(controller: pet, species: 'cat',
    initialState: saved, onStats: (s) => prefs.setString('pet', jsonEncode(s))),
  Row(children: [
    ElevatedButton(onPressed: pet.feed, child: const Text('Besle')),
    ElevatedButton(onPressed: pet.giveWater, child: const Text('Su ver')),
    ElevatedButton(onPressed: pet.sleep, child: const Text('Uyut')),
    ElevatedButton(onPressed: pet.wake, child: const Text('Uyandır')),
  ]),
]);
*/
