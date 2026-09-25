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

## Dispatcher / Task Manager

```text
await dispatcher([blocks], async (loco, dir) => { ... }, options?)
await smartDispatcher([blocks], async (loco, dir, run) => { ... }, options?)
startTask(name, taskFunction)
isTaskRunning(name)
getTaskState(name)
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
9. Dispatcher használat előtt a route gráfot generálni és a Layouttal együtt menteni kell.
10. Ismétlődő, párhuzamos Dispatcher próbálkozásokhoz használd a `startTask()` single-flight Task Managert.


---

# 18. Dispatcher – gráf alapú útvonal- és blokkfoglalás

A `dispatcher()` a Layout mentett route gráfjából választ ki pontosan egy fizikai útvonalat, lefoglalja az érintett blokkokat, szükség esetén SwitchMan segítségével beállítja és zárolja a váltókat, majd a tényleges vonatmozgást a script callbackjére bízza.

## 18.1 Alap használat

```js
const result = await dispatcher(
  ["A1", "B1", "C1"],
  async (loco, dir) => {
    dcc.setLoco(loco, 20, dir);
    await dcc.waitForSensor(1020, true);
    dcc.setLoco(loco, 0, dir);
  }
);
```

A callback paraméterei:

- `loco`: a kiinduló blokkban lévő mozdony DCC címe;
- `dir`: a gráfból meghatározott `"forward"` vagy `"reverse"` menetirány.

Lehetséges eredmény státuszok:

```text
completed
empty
blocked
```

## 18.2 A blokklista checkpoint-lista

A megadott blokkoknak nem kell a teljes fizikai blokkútvonalat tartalmazniuk.

Ha a teljes útvonal:

```text
A1 -> B2 -> C3 -> D4
```

akkor ez is érvényes:

```js
await dispatcher(["A1", "B2", "D4"], async (loco, dir) => {
  // ...
});
```

A checkpointoknak sorrendben kell szerepelniük a teljes útvonalban. Az első és utolsó blokk mindig a kért útvonal kezdő- és végpontja.

Ha nincs találat:

```text
dispatcher_route_not_found
```

Ha több fizikai útvonal is illeszkedik:

```text
dispatcher_route_ambiguous
```

A Dispatcher ilyenkor szándékosan nem választ önkényesen. Adj meg további köztes checkpoint blokkot, amíg pontosan egy útvonal marad.

## 18.3 Blokkfoglalási szabályok

A kiinduló blokk:

- tartalmazhat foglaltságot, hiszen ott áll az induló vonat;
- tényleges mozdony-hozzárendeléséből kapja a Dispatcher a `loco` címet;
- nem tartalmazhat másik target loco jelölést.

A kiinduló blokk után minden útvonalblokk csak akkor szabad, ha egyszerre:

```text
actual loco == 0
target loco == 0
occupancy sensor == false
```

A Dispatcher indulás előtt minden következő blokkra beállítja a mozdony target jelölését, majd újra ellenőrzi, hogy a foglalás közben nem változott-e az állapot.

Az egymást átfedő Dispatcher útvonalak blokkzárolása Web Locks segítségével történik. Ugyanazon scriptben egymást átfedő aktív Dispatcher útvonalak nem engedélyezettek.

## 18.4 Váltók

Ha az útvonal váltóállításokat igényel, a Dispatcher automatikusan SwitchMan foglalást használ.

A gráfban tárolt váltóállásokat beállítja, majd a teljes Dispatcher callback futása alatt megtartja a SwitchMan scope-ot.

Ha a váltókörzet pillanatnyilag foglalt, az adott Dispatcher-próbálkozás `blocked` státusszal visszatér, így a Task Manager / scheduler később újra próbálhatja.

## 18.5 Sikeres commit és rollback

Ha a callback sikeresen befejeződik:

1. a célblokk előtti útvonalblokkok actual + target állapota törlődik;
2. a célblokk target jelölése törlődik;
3. a célblokk actual mozdony-hozzárendelése a Dispatcher mozdonyára áll.

Ha a callback hibával vagy Aborttal megszakad, a Dispatcher **nem állítja azt, hogy a vonat megérkezett**. Csak a saját maga által létrehozott target jelöléseket oldja fel.

## 18.6 Opciók

```js
await dispatcher(
  ["A1", "B1", "C1"],
  async (loco, dir) => {
    // ...
  },
  {
    timeoutMs: 30000,
    setDelayMs: 250,
    blockPollMs: 250,

    onEmpty: async dir => {
      log("A1 üres", dir);
    },

    onBlocked: async (loco, dir, conflicts) => {
      log("Útvonal blokkolt", loco, dir, conflicts);
    },
  }
);
```

- `timeoutMs`: blokk-lock várakozás timeoutja; elhagyva nincs explicit Dispatcher timeout, maximum `600000 ms`;
- `setDelayMs`: váltóállítások közötti késleltetés, alapból `250 ms`;
- `blockPollMs`: blokk-lock újrapróbálási idő, alapból `250 ms`, tartománya `25..5000 ms`;
- `onEmpty(dir)`: akkor fut, ha a kiinduló blokkban nincs mozdony;
- `onBlocked(loco, dir, conflicts)`: blokk- vagy váltókonfliktus esetén fut.

Ha `onEmpty` nincs megadva, az üres kiinduló blokk `dispatcher_empty_source` hibát dob.

---

# 19. Task Manager – párhuzamos single-flight feladatok

A `startTask()` arra való, hogy egy automation scheduler több független async feladatot tudjon párhuzamosan futtatni anélkül, hogy ugyanazt a feladatot egyszerre többször elindítaná.

## 19.1 `startTask(name, taskFunction)`

```js
startTask("A1_TO_C1", A1toC1);
```

A hívás azonnal visszatér; a feladat háttérben fut tovább.

Ugyanazzal a névvel egyszerre csak egy példány futhat. Ha már fut:

```text
started = false
reason = "already-running"
```

Finishing módban új feladat nem indul:

```text
started = false
reason = "finishing"
```

A már futó feladatok befejezhetik az aktuális menetüket.

## 19.2 `isTaskRunning(name)`

```js
if (isTaskRunning("A1_TO_C1")) {
  log("A1_TO_C1 még fut");
}
```

## 19.3 `getTaskState(name)`

```js
const state = getTaskState("A1_TO_C1");
log(state);
```

A state többek között tartalmazza:

```text
name
running
status
runCount
startedAt
finishedAt
lastResult
lastError
```

A Task Manager a háttérfeladat hibáját eltárolja és logolja, így abból nem lesz kezeletlen Promise rejection.

---

# 20. Komplett Dispatcher + Task Manager példa

```js
const SENSOR_A1 = 1001;
const SENSOR_B1 = 1006;
const SENSOR_B2 = 1007;
const SENSOR_C1 = 1020;

const SPEED = 20;
const HORN_FUNCTION = 2;

async function horn(loco) {
  dcc.setLocoFunction(loco, HORN_FUNCTION, true);
  await delay(700);
  dcc.setLocoFunction(loco, HORN_FUNCTION, false);
}

async function A1toC1() {
  await dispatcher(
    ["A1", "B1", "C1"],

    async (loco, dir) => {
      setInfo(`Loco ${loco}: A1 -> B1 -> C1`);

      dcc.setLoco(loco, SPEED, dir);

      await dcc.waitForSensor(SENSOR_B1, true);

      log(`Loco ${loco}: B1`);

      await horn(loco);

      dcc.setLoco(loco, 25, dir);

      await dcc.waitForSensor(SENSOR_C1, true);

      log(`Loco ${loco}: C1`);

      dcc.setLoco(loco, 0, dir);
    },

    {
      onEmpty: async () => {
        log("A1 -> C1: nincs mozdony A1-ben");
      },

      onBlocked: async (loco, dir, conflicts) => {
        log("A1 -> C1: blokkolt", loco, conflicts);
      }
    }
  );
}

async function C1toA1() {
  await dispatcher(
    ["C1", "B2", "A1"],

    async (loco, dir) => {
      setInfo(`Loco ${loco}: C1 -> B2 -> A1`);

      dcc.setLoco(loco, SPEED, dir);

      await dcc.waitForSensor(SENSOR_B2, true);

      log(`Loco ${loco}: B2`);

      await horn(loco);

      dcc.setLoco(loco, 25, dir);

      await dcc.waitForSensor(SENSOR_A1, true);

      log(`Loco ${loco}: A1`);

      dcc.setLoco(loco, 0, dir);
    },

    {
      onEmpty: async () => {
        log("C1 -> A1: nincs mozdony C1-ben");
      },

      onBlocked: async (loco, dir, conflicts) => {
        log("C1 -> A1: blokkolt", loco, conflicts);
      }
    }
  );
}

while (isRunning()) {
  startTask("A1_TO_C1", A1toC1);
  startTask("C1_TO_A1", C1toA1);

  await delay(500);
}

setInfo("Finishing - nincs új dispatcher");
```

A scheduler 500 ms-onként megpróbálja elindítani mindkét menetet. A `startTask()` miatt ugyanaz a menet nem indul el újra, amíg az előző példánya fut. Ha egy Dispatcher próbálkozás `empty` vagy `blocked` státusszal gyorsan befejeződik, egy későbbi scheduler kör újra próbálhatja.


---

# 21. SmartDispatcher – gördülő blokkfoglalás

A \`smartDispatcher()\` a stabil \`dispatcher()\` mellett külön implementáció. A normál Dispatcher továbbra is a teljes útvonalat foglalja le előre; a SmartDispatcher ezzel szemben mindig csak a **jelenlegi és a következő blokkot** tartja.

A SmartDispatcher automatikusan:

- ellenőrzi a következő blokk \`actual\`, \`target\` és occupancy állapotát;
- Web Lockkal lefoglalja a következő blokkot;
- beállítja a következő blokk \`target loco\` jelölését;
- csak az aktuális blokkátmenethez szükséges váltókat foglalja és állítja;
- clearance hiányában megállítja a mozdonyt;
- clearance megjelenésekor visszaállítja a script által kért sebességet;
- biztos megérkezés után felszabadítja az előző blokkot és az előző átmenet váltózárait;
- a célblokkba érkezéskor automatikusan megállítja a mozdonyt.

## 21.1 Alap használat

\`\`\`js
await smartDispatcher(
  ["A1", "B1", "C1"],

  async (loco, dir, run) => {
    run.setSpeed(20);

    await run.waitForBlock("B1");

    await horn(loco);

    run.setSpeed(25);

    await run.waitForBlock("C1");
  }
);
\`\`\`

A SmartDispatcher alatt a normál menethez a \`run.setSpeed()\` használata javasolt a közvetlen \`dcc.setLoco()\` helyett. A SmartDispatcher csak így tudja eltárolni a kívánt sebességet és clearance után automatikusan visszaállítani.

## 21.2 arrivedWhen – biztos blokkba érkezés

Egy blokkhoz explicit szenzorfeltételek adhatók meg:

\`\`\`js
await smartDispatcher(
  [
    "A1",

    {
      block: "B1",
      arrivedWhen: [
        { sensor: 1000, state: true },
        { sensor: 999, state: false }
      ]
    },

    {
      block: "C1",
      arrivedWhen: [
        { sensor: 1010, state: true },
        { sensor: 1000, state: false }
      ]
    }
  ],

  async (loco, dir, run) => {
    run.setSpeed(20);

    await run.waitForBlock("B1");

    await horn(loco);

    await run.waitForBlock("C1");
  }
);
\`\`\`

A példában B1 akkor számít biztosan elfoglaltnak, amikor:

\`\`\`text
sensor 1000 == true
sensor  999 == false
\`\`\`

Ez azt jelenti, hogy a vonat már érzékelhető B1-ben, és az előző szakaszt teljesen elhagyta. Csak ekkor szabadítja fel a SmartDispatcher az előző blokkot.

Ha egy blokkhoz nincs explicit \`arrivedWhen\`, az alapértelmezett feltétel:

\`\`\`text
aktuális blokk occupancy sensor == true
előző blokk occupancy sensor    == false
\`\`\`

Ha két egymást követő blokk ugyanazt az occupancy szenzort használja, explicit \`arrivedWhen\` szükséges.

## 21.3 Clearance és automatikus megállás

A SmartDispatcher a háttérben automatikusan próbálja megszerezni a következő blokkot.

A következő blokk csak akkor használható, ha:

\`\`\`text
actual loco == 0
target loco == 0
occupancy   == false
block Web Lock megszerezhető
szükséges váltózárak megszerezhetők
szükséges váltóállások beállíthatók
\`\`\`

Ha ez nem teljesül, a mozdony fizikai sebessége:

\`\`\`text
0
\`\`\`

de a \`run.setSpeed()\` által kért sebesség megmarad.

Például:

\`\`\`js
run.setSpeed(30);
\`\`\`

Ha a következő blokk foglalt:

\`\`\`text
desired speed  = 30
physical speed = 0
\`\`\`

Amikor a blokk szabaddá válik és a váltók is lefoglalhatók:

\`\`\`text
desired speed  = 30
physical speed = 30
\`\`\`

Ehhez a scriptnek nem kell külön újraindító logikát írnia.

## 21.4 waitForBlock és waitForClearance

\`\`\`js
await run.waitForBlock("B1");
\`\`\`

Azt jelenti, hogy a B1 blokkhoz tartozó \`arrivedWhen\` feltételek már teljesültek, tehát a vonat biztosan megérkezett a blokkba.

\`\`\`js
await run.waitForClearance("C1");
\`\`\`

Azt jelenti, hogy C1 már le van foglalva a vonat számára és a hozzá vezető váltók is rendelkezésre állnak.

A \`waitForClearance()\` **nem szükséges a SmartDispatcher működéséhez**. A clearance kezelése automatikus; ez a függvény akkor hasznos, ha a scriptednek külön meg kell várnia vagy tudnia kell, hogy már szabad az út.

## 21.5 Tetszőleges pályamenti szenzorok

A SmartDispatcher blokkkezelése mellett a normál szenzor API továbbra is használható:

\`\`\`js
await run.waitForBlock("B1");

await dcc.waitForSensor(1234, true);

await horn(loco);
\`\`\`

Így a blokkoktól független tetszőleges ponton lehet például kürtölni, lassítani vagy más műveletet végezni.

## 21.6 run API

\`\`\`text
run.setSpeed(speed)
run.stop()
await run.waitForBlock(blockName)
await run.waitForClearance(blockName)
run.getCurrentBlock()
run.getNextBlock()
run.getRoute()
run.getDesiredSpeed()
\`\`\`

A sebességtartomány \`0..126\`.

## 21.7 Opciók

\`\`\`js
await smartDispatcher(
  ["A1", "B1", "C1"],
  async (loco, dir, run) => {
    run.setSpeed(20);
    await run.waitForBlock("C1");
  },
  {
    setDelayMs: 250,
    blockPollMs: 100,

    onEmpty: async dir => {
      log("A1 üres", dir);
    },

    onBlocked: async (loco, dir, conflicts) => {
      log("SmartDispatcher vár", loco, conflicts);
    }
  }
);
\`\`\`

- \`setDelayMs\`: egymást követő váltóállítások közötti késleltetés;
- \`blockPollMs\`: a blokk- és érkezési feltételek ellenőrzési periódusa, \`25..5000 ms\`;
- \`onEmpty(dir)\`: üres induló blokk;
- \`onBlocked(loco, dir, conflicts)\`: akkor fut, amikor az adott következő blokkra első alkalommal várni kell.

A SmartDispatcher a célblokkba történő biztos megérkezéskor automatikusan \`0\` sebességre állítja a mozdonyt.
