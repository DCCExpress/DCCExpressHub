# Canvas-elemek

A HUB összes canvas-eleme a `web-ui/src/models/editor` alatti közös
osztályhierarchiát használja. Egy elem geometriája, mentése, rajzolása és
szerkesztőbeli viselkedése ugyanabban az osztályban található.

```text
BaseElement (abstract)
├─ ClickableBaseElement (abstract)
│  └─ gombok, vágányútgombok, hang- és scriptgombok
├─ ClockElement, LabelElement, TreeElement
└─ TrackElement (abstract)
   ├─ TrackStraightElement, TrackCurveElement, TrackCornerElement, …
   ├─ BlockElement, TrackSensorElement, TrackSignalElement
   ├─ TrackTurnoutElement (abstract)
   │  └─ TrackTurnoutLeftElement, TrackTurnoutRightElement, TrackTurnoutTwoWayElement
   └─ TrackMultiMotorTurnoutElement (abstract)
      └─ TrackTurnoutDoubleElement, TrackTurnoutThreeWayElement
```

- `core/BaseElement.ts`: azonosító, pozíció, forgatás, geometria, közös
  JSON-mezők, canvas-koordináták, kijelölés és eseménykezelési alapmetódusok.
  A `draw()` és a `clone()` absztrakt.
- `core/TrackElement.ts`: sínállapot, foglaltság, közös színprioritás,
  szakaszfelirat, haladási irány, sínrajzolási konstansok és foglaltsági
  tulajdonság. A blokk, a szenzor és a jelző saját tulajdonságpanelt használ.
- `elements/TrackTurnoutElement.ts`: egymotoros váltók közös rajzolási menete,
  kattintása, kimeneti konfigurációja és mentése. A konkrét váltó a
  `drawTurnout()` és `getConnections()` metódusokat valósítja meg.
- `elements/TrackMultiMotorTurnoutElement.ts`: közös motorállapotok és rajzolási
  menet. A leszármazott `drawTrack()` és `drawAddressLabels()` metódusokkal
  adja meg a saját alakját és címfeliratait.

A TypeScript metódusai alapból felülírhatók; nincs külön `virtual` kulcsszó.
Az örökölt működés módosítását `override` jelöli, amit a `noImplicitOverride`
fordítóbeállítás ellenőriz. Új elemnél a legközelebbi megfelelő ősből kell
örökölni, és csak az eltérő viselkedést felülírni. A tulajdonságpanelek
`super.getEditableProperties()`-re épülnek.

A korábbi `*ElementView` osztályok, a párhuzamos domain-elemimplementációk,
a három `*ElementViewSupport` modul és az elemprototype-okat utólag átíró
installerek megszűntek. Nincs kompatibilitási wrapper; a factory, a canvas,
a tulajdonságpanel és a topológia közvetlenül az új osztályokat használja.
A `LayoutView` és a `LayerView` továbbra is a rétegeket és az egész pályát
kezelő konténerek, nem külön elemimplementációk.

A mentett elemtípusok és a numerikus pályaelem-azonosítók megmaradtak.
A fájlformátumot továbbra is a `domain/layout/layoutDto.ts` írja le.
A váltók extended aspect mezői most típusosan, az osztályok saját
betöltési/mentési/másolási metódusaiban szerepelnek. A klón azonosítóját
a pályához adáskor osztja ki a layout. A `getTrackElements()` csak tényleges
`TrackElement` példányokat ad vissza, a sínrétegre tett gombokat kihagyja.

Ellenőrzés a `web-ui` könyvtárból:

```sh
npm run typecheck
npm test
npm run build
```

A tesztek az öröklést, a factoryt, a klónozást, a váltókonfigurációt,
a geometriai felülírásokat és a vágányutakat ellenőrzik. A rajzolási
regresszióteszt 15 vasúti elemtípus 240 canvas-hívássorozatát hasonlítja
az átalakítás előtt rögzített SHA-256 lenyomatokhoz; ez nem böngészős
képpont-összehasonlítás és nem hardverteszt.
