# DCCExpressHub – Automation Script API


## 1. Alapok

A Hub automation scriptek aszinkron JavaScriptként futnak. Emiatt a várakozó műveleteknél `await` használható, miközben a UI és a script Pause / Resume / Abort működése megmarad.

### Saját async függvény

```js
async function runTrain() {
  dcc.setLoco(18, 30, "forward");
  await delay(1000);
  dcc.setLoco(18, 0, "forward");
}

await runTrain();
```

### `await delay(ms)`

Nem blokkoló várakozás.

```js
await delay(1000);
```

### `await Promise.all([...])`

Több aszinkron művelet párhuzamos futtatása.

```js
await Promise.all([
  task1(),
  task2(),
]);
```

### `setInfo(message)`

Ideiglenes információ megjelenítése a futó automation kártyán.

```js
setInfo("Mozdony indul a B1 blokkba");
```

Üzenet törlése:

```js
setInfo("");
```

### `log(value, ...)`

Logolás a böngésző konzoljába az automation nevével.

```js
log("P101 elérte a következő pontot", 33);
```

### `element`

A scriptet futtató automation elem biztonságos, read-only kontextusa.

```js
log(element.id, element.name);
```

---

## 2. Automation Control – Running / Finishing

### `isRunning()`

`true`, amíg az Automation Control normál futási módban van.

Tipikus ciklus:

```js
while (isRunning()) {
  await runSequence();
}
```

Ha közben Finishing módba kapcsolunk, az aktuális `runSequence()` befejeződik, de új ciklus már nem indul.

### `isFinishing()`

`true`, ha a globális Finishing mód aktív.

```js
if (isFinishing()) {
  return;
}
```

### Javasolt ciklikus script

```js
async function runSequence() {
  setInfo("A -> B");
  dcc.setLoco(18, 30, "forward");
  await dcc.waitForSensor(33, true);

  setInfo("B -> A");
  dcc.setLoco(18, 30, "reverse");
  await dcc.waitForSensor(20, true);
}

while (isRunning()) {
  await runSequence();
}

dcc.setLoco(18, 0, "forward");
setInfo("Befejezve");
```

---

# 3. SwitchMan – váltókörzet foglalás

A `switchMan()` egy váltócsoportot **atomikusan, all-or-none módon** foglal le.

```text
1. kéri a teljes váltócsoportot
2. ha bármelyik foglalt -> vár
3. ha mind szabad -> egyszerre lefoglalja az összeset
4. lefut a callback
5. a callback végén a foglalást automatikusan feloldja
```

A callback normál befejezése, exception vagy kontrollált abort esetén a `finally` ág megpróbálja feloldani a foglalást.

## 3.1 Egyszerű SwitchMan példa

```js
await switchMan([10, 11], async sw => {
  setInfo("Váltókörzet beállítása");

  await sw.setTurnout(10, true);
  await sw.setTurnout(11, false);

  setInfo("Indulás");
  dcc.setLoco(18, 30, "forward");

  await dcc.waitForSensor(33, true);
});
```

A callback vége után a `10` és `11` váltó automatikusan felszabadul.

## 3.2 `sw.setTurnout(address, closed)`

Csak az adott SwitchMan scope által lefoglalt váltó állítható.

```js
await sw.setTurnout(10, true);
```

A `closed` logikai állapot:

```js
true   // CLOSED
false  // THROWN
```

Ez hibát ad, ha a scope például csak `[10, 11]` váltót birtokolja:

```js
await sw.setTurnout(25, true);
```

## 3.3 Két egymást követő váltókörzet

```js
await switchMan([10, 11], async sw => {
  await sw.setTurnout(10, true);
  await sw.setTurnout(11, false);

  dcc.setLoco(18, 30, "forward");
  await dcc.waitForSensor(33, true);
});

await dcc.waitForSensor(40, true);

await switchMan([20, 21, 22], async sw => {
  await sw.setTurnout(20, false);
  await sw.setTurnout(21, true);
  await sw.setTurnout(22, true);

  await dcc.waitForSensor(55, true);
});

dcc.setLoco(18, 0, "forward");
```

## 3.4 Két script ugyanarra a váltóra

P101:

```js
await switchMan([10, 11], async sw => {
  // ...
});
```

P202:

```js
await switchMan([11, 12], async sw => {
  // ...
});
```

Ha P101 birtokolja a `10, 11` csoportot, akkor P202 vár. Amikor P101 elengedi a csoportot, P202 atomikusan megkaphatja a `11, 12` váltókat.

Várakozás közben a script információ például:

```text
Váltókörzetre vár: 11 (P101)
```

## 3.5 Timeout

Alapértelmezésben a SwitchMan **korlátlan ideig vár**.

```js
await switchMan([10, 11], async sw => {
  await sw.setTurnout(10, true);
  await sw.setTurnout(11, false);
}, 30000);
```

Ez legfeljebb 30 másodpercig vár.

```js
await switchMan([10, 11], async sw => {
  // ...
}, 0);
```

A `0` azonnali timeoutot jelent, ha a teljes csoport nem szabad.

A megadható timeout jelenleg legfeljebb `600000 ms` (10 perc).

## 3.6 Finishing + SwitchMan

```js
async function runCycle() {
  await switchMan([10, 11], async sw => {
    await sw.setTurnout(10, true);
    await sw.setTurnout(11, false);

    dcc.setLoco(18, 30, "forward");
    await dcc.waitForSensor(33, true);
  });

  await switchMan([20, 21], async sw => {
    await sw.setTurnout(20, false);
    await sw.setTurnout(21, true);

    await dcc.waitForSensor(55, true);
  });
}

while (isRunning()) {
  await runCycle();
}

dcc.setLoco(18, 0, "forward");
```

Finishing közben a már megkezdett ciklus befejezhető, de új ciklus nem indul.

## 3.7 Fontos SwitchMan szabályok

- A teljes váltócsoport foglalása atomikus.
- Egy script egymásba ágyazott, egymást átfedő SwitchMan scope-jai tiltottak.
- Például `[10, 11]` belsejében új `[11, 12]` scope hibát ad, mert önmagára várna.
- SwitchMan callbacken belül a lefoglalt váltókhoz `await sw.setTurnout(...)` használata ajánlott.
- A normál `dcc.setTurnout(...)` nem kapja meg a SwitchMan scope tulajdonjogát.
- A backend lock a végső authoritative védelem.
- A WebUI piros villogó váltójelzése csak vizuális reprezentáció; a valódi lock a backendben él.

---

# 4. RouteButton

### `await setRoute(name)`

A név alapján beállít egy RouteButtont. A route lépései között alapból 250 ms várakozás van.

```js
await setRoute("Bejárat 1");
```

### `await setRoute(name, delayMs)`

Egyedi késleltetés a route lépései között.

```js
await setRoute("Bejárat 1", 100);
```

> SwitchMan által lefoglalt váltók beállításához a SwitchMan scope-on belül inkább `sw.setTurnout()` használható. A normál route-parancsot a backend lock visszautasíthatja, ha zárolt váltót próbál állítani.

---

# 5. Mozdonyok és táp

## `dcc.setLoco(address, speed, direction)`

Mozdony sebesség és irány.

- cím: `1..10239`
- sebesség: `0..126`
- irány: `"forward"` vagy `"reverse"`

```js
dcc.setLoco(18, 30, "forward");
```

Megállítás:

```js
dcc.setLoco(18, 0, "forward");
```

## `dcc.setLocoFunction(address, function, active)`

F0–F28 funkció.

```js
dcc.setLocoFunction(18, 0, true);
dcc.setLocoFunction(18, 2, false);
```

## `dcc.setPower(on)`

Fővágány táp.

```js
dcc.setPower(true);
dcc.setPower(false);
```

## `dcc.setProgrammingPower(on)`

Programozóvágány táp.

```js
dcc.setProgrammingPower(true);
```

## `dcc.emergencyStop()`

Azonnali emergency stop.

```js
dcc.emergencyStop();
```

---

# 6. Szenzorok

A script API szempontjából a szenzor egységes szenzor. Nem számít, hogy S88, `<Q>` vagy más backend forrás adja az állapotát.

## `dcc.getSensor(address)`

A lokálisan cache-elt szenzorállapot.

```js
const occupied = dcc.getSensor(33);

if (occupied) {
  log("33 foglalt");
}
```

## `dcc.setSensor(address, on)`

Szenzor runtime állapot beállítása.

```js
dcc.setSensor(33, true);
```

## `dcc.waitForSensor(address, on, timeoutMs?)`

Event-driven várakozás egy szenzorállapotra.

Timeout nélkül korlátlan ideig vár:

```js
await dcc.waitForSensor(33, true);
```

10 másodperces timeout:

```js
await dcc.waitForSensor(33, true, 10000);
```

Felszabadulásra várás:

```js
await dcc.waitForSensor(33, false);
```

A megadott wait timeout jelenleg `1..600000 ms`.

---

# 7. Váltók

A normál turnout API a Layoutban konfigurált logikai váltóállapotokat használja.

## `dcc.getTurnout(address)`

Aktuális logikai állapot.

```js
const closed = dcc.getTurnout(20);
```

## `dcc.isClosed(address)`

```js
if (dcc.isClosed(20)) {
  log("CLOSED");
}
```

## `dcc.isThrown(address)`

```js
if (dcc.isThrown(20)) {
  log("THROWN");
}
```

## `dcc.setTurnout(address, closed)`

```js
dcc.setTurnout(20, true);   // CLOSED
dcc.setTurnout(20, false);  // THROWN
```

## `dcc.setClosed(address)`

```js
dcc.setClosed(20);
```

## `dcc.setThrown(address)`

```js
dcc.setThrown(20);
```

## `dcc.waitForTurnout(address, closed, timeoutMs?)`

```js
await dcc.waitForTurnout(20, true);
```

Timeouttal:

```js
await dcc.waitForTurnout(20, true, 10000);
```

## `dcc.waitForClosed(address, timeoutMs?)`

```js
await dcc.waitForClosed(20);
```

## `dcc.waitForThrown(address, timeoutMs?)`

```js
await dcc.waitForThrown(20);
```

---

# 8. Jelzők

A magas szintű signal API a Layoutban konfigurált logikai jelzőállapotokat használja.

## `dcc.getSignalState(address)`

```js
const state = dcc.getSignalState(100);
log(state);
```

## `dcc.isSignalState(address, stateName)`

```js
if (dcc.isSignalState(100, "Slow")) {
  log("Lassú menet");
}
```

## Színállapot lekérdezések

```js
dcc.isRed(100);
dcc.isGreen(100);
dcc.isYellow(100);
dcc.isWhite(100);
```

## `dcc.setSignalState(address, stateName)`

```js
dcc.setSignalState(100, "Slow");
```

## Színállapot beállítások

```js
dcc.setRed(100);
dcc.setGreen(100);
dcc.setYellow(100);
dcc.setWhite(100);
```

## `dcc.waitForSignalState(address, stateName, timeoutMs?)`

```js
await dcc.waitForSignalState(100, "Slow");
```

Timeouttal:

```js
await dcc.waitForSignalState(100, "Slow", 10000);
```

## Színállapot várakozások

```js
await dcc.waitForRed(100);
await dcc.waitForGreen(100);
await dcc.waitForYellow(100);
await dcc.waitForWhite(100);
```

Mindegyik kaphat opcionális `timeoutMs` paramétert.

## `dcc.setSignalAspect(address, aspect)`

Alacsony szintű explicit DCC extended signal aspect.

- jelzőcím: `1..2048`
- aspect: `0..255`

```js
dcc.setSignalAspect(100, 16);
```

Ha van Layoutban konfigurált logikai jelzőállapot, új scriptben általában a `setSignalState()` / `setRed()` / `setGreen()` stb. használata jobb.

---

# 9. Blokkok

A blokk megadható névvel vagy numerikus Layout ID-val.

## `dcc.getBlock(blockName)`

A blokkban lévő DCC mozdonycímet adja vissza, vagy `0`-t.

```js
const loco = dcc.getBlock("A1");

if (loco === 18) {
  log("A1-ben a 18-as mozdony van");
}
```

## `dcc.setBlock(blockName, locoAddress)`

```js
dcc.setBlock("A2", 18);
```

## `dcc.clearBlock(blockName)`

```js
dcc.clearBlock("A2");
```

## `dcc.resetBlocks()`

Minden runtime blokk-hozzárendelés törlése.

```js
dcc.resetBlocks();
```

## `dcc.getBlockTargetLoco(blockName)`

A blokk felé tartóként megjelölt mozdony címét adja vissza, vagy `0`-t.

```js
const target = dcc.getBlockTargetLoco("A2");
```

## `dcc.setBlockTargetLoco(blockName, locoAddress)`

```js
dcc.setBlockTargetLoco("A2", 18);
```

## `dcc.clearBlockTargetLoco(blockName)`

```js
dcc.clearBlockTargetLoco("A2");
```

---

# 10. Egyéb DCC / output műveletek

## `dcc.setAccessory(address, active)`

Alacsony szintű basic DCC accessory setter.

```js
dcc.setAccessory(100, true);
```

## `dcc.sendRaw("<DCC-EX command>")`

Nyers DCC-EX parancs küldése.

```js
dcc.sendRaw("<s>");
```

Új scriptnél, ha van hozzá magasabb szintű `dcc.*` API, inkább azt érdemes használni.

---

# 11. Hang lejátszás

## `playAudio(name)`

Az SD kártya audio könyvtárából játszik le MP3-at.

Csak az alap fájlnév kell, útvonal és `.mp3` kiterjesztés nélkül:

```js
playAudio("mav_szignal");
```

---

# 12. Komplett egyszerű vonatmenet

```js
setInfo("P101 indulásra kész");

await switchMan([10, 11], async sw => {
  setInfo("P101 váltókörzet beállítása");

  await sw.setTurnout(10, true);
  await sw.setTurnout(11, false);

  dcc.setGreen(100);

  dcc.setBlockTargetLoco("B2", 18);

  setInfo("P101 indul");
  dcc.setLoco(18, 30, "forward");

  await dcc.waitForSensor(33, true, 30000);

  dcc.setLoco(18, 0, "forward");
  dcc.setRed(100);

  dcc.clearBlockTargetLoco("B2");
  dcc.setBlock("B2", 18);

  setInfo("P101 megérkezett B2-be");
});
```

---

# 13. Komplett ciklikus vonatmenet Finishing támogatással

```js
async function AtoB() {
  await switchMan([10, 11], async sw => {
    setInfo("A -> B váltókörzet");

    await sw.setTurnout(10, true);
    await sw.setTurnout(11, false);

    dcc.setLoco(18, 30, "forward");

    await dcc.waitForSensor(33, true);
    dcc.setLoco(18, 0, "forward");
  });
}

async function BtoA() {
  await switchMan([20, 21], async sw => {
    setInfo("B -> A váltókörzet");

    await sw.setTurnout(20, false);
    await sw.setTurnout(21, true);

    dcc.setLoco(18, 30, "reverse");

    await dcc.waitForSensor(20, true);
    dcc.setLoco(18, 0, "reverse");
  });
}

while (isRunning()) {
  await AtoB();

  if (isFinishing()) {
    break;
  }

  await BtoA();
}

setInfo("P101 befejezve");
```

---

# 14. Ajánlott Quick Help API – rövid lista

## JavaScript / runtime

```text
async function name()
await delay(ms)
await Promise.all([...])
isFinishing()
isRunning()
log(value, ...)
setInfo(message)
playAudio(name)
```

## SwitchMan

```text
await switchMan([turnouts], async sw => { ... })
await switchMan([turnouts], async sw => { ... }, timeoutMs)
await sw.setTurnout(address, closed)
```

## Route

```text
await setRoute(name)
await setRoute(name, delayMs)
```

## Blocks

```text
dcc.clearBlock(blockName)
dcc.clearBlockTargetLoco(blockName)
dcc.getBlock(blockName)
dcc.getBlockTargetLoco(blockName)
dcc.resetBlocks()
dcc.setBlock(blockName, locoAddress)
dcc.setBlockTargetLoco(blockName, locoAddress)
```

## Sensors

```text
dcc.getSensor(address)
dcc.setSensor(address, on)
dcc.waitForSensor(address, on, timeoutMs?)
```

## Turnouts

```text
dcc.getTurnout(address)
dcc.isClosed(address)
dcc.isThrown(address)
dcc.setClosed(address)
dcc.setThrown(address)
dcc.setTurnout(address, closed)
dcc.waitForClosed(address, timeoutMs?)
dcc.waitForThrown(address, timeoutMs?)
dcc.waitForTurnout(address, closed, timeoutMs?)
```

## Signals

```text
dcc.getSignalState(address)
dcc.isGreen(address)
dcc.isRed(address)
dcc.isSignalState(address, stateName)
dcc.isWhite(address)
dcc.isYellow(address)
dcc.setGreen(address)
dcc.setRed(address)
dcc.setSignalAspect(address, aspect)
dcc.setSignalState(address, stateName)
dcc.setWhite(address)
dcc.setYellow(address)
dcc.waitForGreen(address, timeoutMs?)
dcc.waitForRed(address, timeoutMs?)
dcc.waitForSignalState(address, stateName, timeoutMs?)
dcc.waitForWhite(address, timeoutMs?)
dcc.waitForYellow(address, timeoutMs?)
```

## Power / loco / low level

```text
dcc.emergencyStop()
dcc.sendRaw("<DCC-EX command>")
dcc.setAccessory(address, active)
dcc.setLoco(address, speed, "forward|reverse")
dcc.setLocoFunction(address, function, active)
dcc.setPower(on)
dcc.setProgrammingPower(on)
```

---

# 15. Runtime-ban még meglévő advanced / compatibility API

Ezek ténylegesen léteznek a worker runtime-ban, de **nem részei az ajánlott Quick Help API-nak**.

## `dcc.setTurnoutRaw(address, closed)`

Alacsony szintű turnout parancs, amely nem a Layout logikai turnout konfigurációját használja.

```js
dcc.setTurnoutRaw(20, true);
```

Új scriptekben általában:

```js
dcc.setTurnout(20, true);
```

vagy SwitchMan scope-ban:

```js
await sw.setTurnout(20, true);
```

használata ajánlott.

## `dcc.block(blockId, locoId, locoAddress?)`

Alacsonyabb szintű blokk-hozzárendelési API. Normál automation scriptben inkább a `setBlock()` / `clearBlock()` használata javasolt.

---

# 16. Legacy aliasok

A runtime kompatibilitás miatt még léteznek:

```text
dcc.power(on)
dcc.programmingPower(on)
dcc.loco(address, speed, direction)
dcc.locoFunction(address, function, active)
dcc.turnout(address, closed)
dcc.sensor(address, on)
dcc.accessory(address, active)
dcc.signal(address, aspect)
dcc.raw(command)
```

Új scriptekben ezek helyett az explicit neveket használd:

```text
dcc.setPower(...)
dcc.setProgrammingPower(...)
dcc.setLoco(...)
dcc.setLocoFunction(...)
dcc.setTurnout(...)
dcc.setSensor(...)
dcc.setAccessory(...)
dcc.setSignalAspect(...)
dcc.sendRaw(...)
```

---

# 17. Rövid szabályok

1. Szenzorra, váltóra vagy jelzőállapotra várásnál használj `await`-et.
2. A `waitFor*()` timeout elhagyása általában korlátlan várakozást jelent.
3. Váltókörzetek konfliktusvédelméhez használj `switchMan()`-t.
4. SwitchMan scope-ban a lefoglalt váltókat `await sw.setTurnout()`-tal állítsd.
5. Ciklikus automationnél a külső ciklust `isRunning()` / `isFinishing()` alapján vezesd.
6. Ha van magas szintű logikai API, azt részesítsd előnyben a raw DCC parancsokkal szemben.
7. Az S88 / `<Q>` / egyéb érzékelőforrás a script számára ugyanaz a szenzor API.
8. Az emergency stop közvetlenül elérhető: `dcc.emergencyStop()`.
