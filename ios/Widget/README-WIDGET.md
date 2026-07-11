# iOS-widget instellen (eenmalig, ±5 minuten)

De widget-code is klaar (`ADHDWidget.swift` in deze map). Apple staat alleen niet toe dat een widget-target buiten Xcode om wordt aangemaakt — dat zijn deze klikken:

## 1. Widget-target aanmaken
1. Open `App.xcworkspace` in Xcode.
2. Menu **File → New → Target…**
3. Kies **Widget Extension** → Next.
4. Product Name: **ADHDWidget** — vink **"Include Configuration App Intent"** UIT (belangrijk!) → Finish.
5. Als Xcode vraagt "Activate scheme?" → **Cancel** (we blijven in het App-schema bouwen).

## 2. Code vervangen
1. Xcode heeft een map **ADHDWidget** aangemaakt met een paar Swift-bestanden.
2. Verwijder de inhoud van het gegenereerde hoofdbestand (bijv. `ADHDWidget.swift`) en plak daar de volledige inhoud van **dit** `ios/Widget/ADHDWidget.swift` in. Verwijder eventuele andere gegenereerde .swift-bestanden in die map (Bundle/Control/LiveActivity), zodat alleen het ene bestand overblijft.

## 3. App Group aanzetten (deelt data tussen app en widget)
1. Klik op het project → target **App** → **Signing & Capabilities** → **+ Capability** → **App Groups** → voeg toe: `group.be.adhdcalendar.app`.
2. Herhaal exact hetzelfde voor target **ADHDWidget**.
   (Zelfde Team selecteren als bij de App als daarom gevraagd wordt.)

## 4. Bouwen
- Selecteer het **App**-schema → ▶ op je iPhone.
- Voeg de widget toe: lang drukken op je beginscherm → **+** (linksboven, of "Bewerk" → Widget toevoegen) → zoek **ADHD Calendar** → kies formaat → Voeg toe.

De widget toont vandaag: events (kleurbalkje + tijd) en taken (cirkels, afgevinkt = doorgestreept). De app ververst de widget automatisch bij elke wijziging.

**Beperkingen v1**: afvinken kan (nog) niet vanuit de widget zelf — tik erop en de app opent. Interactieve widget-knoppen (iOS 17 App Intents) zijn een mogelijke volgende stap.
