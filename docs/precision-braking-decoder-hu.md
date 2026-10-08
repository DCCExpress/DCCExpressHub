# Precision Braking – dekóder és pálya előkészítése

Ez az útmutató a DCCExpressHub **Precision Braking** méréséhez készült. A mérés előtt a felhasználó feladata a pálya fizikai elkülönítése, a rendelkezésre álló megállási hely és a vészleállítás biztosítása. A Hub nem tudja garantálni, hogy a vonat a kijelölt szakaszon belül áll meg.

## Miért számít a CV4?

A dekóder is végezhet késleltetett fékezést a DCC sebességparancsok után. Ha a Hub saját fékezési rámpát küld, a két hatás összeadódhat. A legegyszerűbb kiindulási teszt: azonos sebességnél **egyetlen 0-s sebességparanccsal** mérjük meg a dekóder tényleges megállási távolságát.

**DigiTools DigiSound 4.x / 5.x (CV7 legalább 40) esetén** az alábbi beállításokat a DigiSound kezelési útmutató 2023-02-25 kiadása tartalmazza (19., 29., 32–33., 41., 44., 53. és 55–58. oldal). Más gyártóknál ugyanezek a CV-számok eltérő viselkedésűek lehetnek.

| Beállítás | DigiSound jelentés | Precision Braking szempont |
|---|---|---|
| **CV3** | Gyorsítási késleltetés. Gyári érték: 31. | Az elindulást befolyásolja, ezért a próba sebességét csak stabil haladásnál értékeld. |
| **CV4** | Lassítási késleltetés. Gyári érték: 10. | **0-nál nincs dekóderes lassítási késleltetés**; a számítógép által küldött sebességváltozást közvetlenebbül követi. |
| **CV49, bit 2** (érték 4) | Induláskor és megállás előtt megnyújtja a késleltetést. | A bit állapotát ellenőrizd, ha a megállás nem ismételhető. Ne írd felül a teljes CV49-et más bitek figyelembevétele nélkül. |
| **CV166** | A gyorsítás-lassítás tiltásához rendelt funkciógomb száma, gyárilag 6. | Ha az **F6 aktív**, a dekóder megkerülheti a saját gyorsítási/lassítási vezérlőjét. Az F6 tolatási módhoz is tartozhat (CV167). |
| **CV324 / CV326** | A „nehéz vonat” funkció hozzárendelése / külön lassítási értéke. | Bekapcsolt nehézvonat-funkció esetén **CV326** léphet a CV4 helyébe. |
| **CV49, bit 1 és CV50** | Állandó fékút ABC/fékgenerátoros szakaszon. | Ez **nem** a Hub normál sebességparancsos fékezési rámpája. Ne keverd össze a két üzemmódot. |
| **CV57** | Programozóvágány ACK-impulzus erőssége, gyári 128. | Ha a DCC-EX programozóvágányon sikertelen az írás vagy olvasás, az ACK-jel túl gyenge lehet. |

## Javasolt próbasorrend

1. Egy **fizikailag elkülönített, üres** tesztpályán próbálj; legyen elég hely a legrosszabb megálláshoz, és legyen kéznél a **Stop / E-STOP**.
2. Programozóvágányon olvasd ki és mentsd el legalább a **CV3, CV4, CV49, CV166, CV324 és CV326** értékeket. A DigiSound esetén a CV4-et – **ha a saját lassítási késleltetést ki akarod kapcsolni** – állítsd 0-ra, majd olvasd vissza, hogy tényleg elmentette-e.
3. Ellenőrizd, hogy nincs-e aktiválva a gyorsítás-lassítás tiltása, a nehéz vonat vagy az ABC/állandó fékút olyan módon, amely félrevezetné a mérést.
4. Válassz megközelítési sebességet, például 40-es DCC-fokozatot. A próba referencia-szenzorát követően mérd meg, milyen hosszú úton áll meg a mozdony **azonnali sebesség = 0** parancs után. A korábbi hibás tanulási adatokhoz használd a **Reset profile** gombot.
5. Ha a tényleges legkisebb fékút **hosszabb, mint a rendelkezésre álló hely**, csökkentsd a megközelítési sebességet vagy helyezd korábbra a fékezés kezdőpontját. **Ezt szoftveres korrekció nem képes felülírni.**
6. Ha a legkisebb fékút megfelelő, új, azonos CV-beállításokkal készült próbák alapján fokozatosan finomítsd a Hub fékezési rámpáját. CV-változtatás után a korábbi fékezési méréseket érdemes törölni.

### Rövid példa

Ha a célfékút 200 mm, de a 40-es fokozatról egyetlen nulla parancs mellett is 280 mm a tényleges megállás, akkor **a szenzortól számított 200 mm fizikailag nem elérhető** ezen a sebességen. Csökkentsd a megközelítési fokozatot, vagy korábban kezdd a fékezést. Ha viszont azonnali nullára állítva 90 mm alatt megáll, de a Hub rámpájával 280 mm-t fut, akkor a **Hub által alkalmazott rámpát** kell rövidíteni.

## Programozóvágány és POM

- DCC-EX programozóvágányon CV4 olvasás: `<R 4>`; CV4=0 írás: `<W 4 0>`. Az írást **külön visszaolvasással** ellenőrizd.
- Fővágányon POM írás mozdony 18-ra: `<w 18 4 0>`. A parancs elküldése önmagában **nem bizonyítja** a dekóder sikeres átprogramozását.
- **CV8 = 0 / 8 / 16**: a DigiSound saját visszaállítási és mentési parancsai. Ezek **nem** egy-egy CV visszaírását jelentik! Ne használd őket fékút-próbaként.

**Forrás:** DigiTools, *DigiSound-4.x / DigiSound-5.x kezelési útmutató*, dokumentumverzió 20230225; dekóderszoftver CV7≥40. Ez az oldal segédlet, nem helyettesíti a gyártói dokumentációt.
