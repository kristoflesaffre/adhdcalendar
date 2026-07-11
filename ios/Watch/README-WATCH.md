# Apple Watch-app instellen (eenmalig, ±5 minuten)

De watch-code is klaar (`ADHDWatchApp.swift` in deze map). De iPhone-kant is al ingebouwd: elke keer dat de app een alarm inplant, wordt het automatisch naar de Watch gestuurd.

## Wat de Watch-app doet
- Toont het eerstvolgende alarm (tijd + titel).
- Op het alarmmoment wekt de Watch je met **krachtige herhaalde tikken** — óók met het scherm uit, tot 30 minuten lang (het officiële "smart alarm"-mechanisme van watchOS, hetzelfde dat wekker-apps gebruiken). Er verschijnt een **Stop**-scherm op de Watch.
- Eerlijke grens van watchOS: continu *geluid* met het scherm uit staat Apple niet toe voor apps — de pols-tikken zijn het wekmechanisme. (Je iPhone rinkelt ondertussen gewoon voluit door.)

## Stappen in Xcode

### 1. Watch-target aanmaken
1. Open `App.xcworkspace` → menu **File → New → Target…**
2. Tab **watchOS** → kies **App** → Next.
3. Product Name: **ADHDWatch**. Interface: SwiftUI. Zet **"Watch App for Existing iOS App"** aan als die optie er staat (of kies bij "Embed in Companion Application" jouw **App**). → Finish.
4. "Activate scheme?" → **Cancel**.

### 2. Code vervangen
1. In de nieuwe **ADHDWatch**-map die Xcode aanmaakte: open het hoofdbestand (bijv. `ADHDWatchApp.swift` of `ContentView.swift`).
2. Verwijder de inhoud van beide gegenereerde Swift-bestanden en plak de volledige inhoud van **dit** `ios/Watch/ADHDWatchApp.swift` in één van de twee; laat het andere bestand leeg of verwijder het uit het project.

### 3. Smart-alarm toestemming in Info
1. Klik project → target **ADHDWatch** → tab **Info**.
2. Voeg een nieuwe rij toe: key **WKSupportedExtendedRuntimeSessionTypes** (type Array) met één item: **smart-alarm**.

### 4. Bouwen
1. Selecteer het **App**-schema → ▶ op je iPhone. Xcode installeert de watch-app automatisch mee (check de Watch-app op je iPhone → ADHD Calendar → "Toon app op Apple Watch").
2. Open de app één keer op je Watch zodat de koppeling actief wordt.

## Testen
1. iPhone: Instellingen → "Send test alarm in 15s" (of maak een echt event met alarm).
2. Kijk op de Watch: "Next alarm 15:42" verschijnt binnen enkele seconden.
3. Op het alarmmoment: pols-tikken elke 2 seconden + Stop-scherm op de Watch, terwijl je iPhone de Cucaracha speelt.

## Beperkingen (watchOS-regels, geen keuzes van ons)
- Alleen het **eerstvolgende** alarm wordt op de Watch gepland (watchOS staat één geplande smart-alarm-sessie tegelijk toe) — na afloop stuurt de iPhone automatisch het volgende.
- Tikken max. 30 minuten per alarm.
- De Watch moet gekoppeld zijn en de watch-app geïnstalleerd; synchronisatie loopt via de iPhone.
