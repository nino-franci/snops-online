# Šnops Online – družinska online igra

Mobilno prilagojena spletna igra za 3 ali 4 igralce. Vsak igralec igra na svojem telefonu; stanje igre se sinhronizira prek Socket.IO.

## Funkcije

- sobe s 5-mestno kodo in deljenje povezave,
- 3 igralci: 3 + 3 kart, 2 karti v talonu, izbira aduta ali 4. karte, menjava talona,
- 4 igralci: 3 + 2 kart, rufana karta, skriti partner do odigrane rufane karte,
- 20 kart: J/Q/K/10/A, vrednosti 2/3/4/10/11,
- preverjanje dovoljenih kart: barvanje, preštihanje in adut,
- napovedi 20/40,
- navadna igra do 66 ali zadnjega štiha,
- posebne igre: Šnops, Berač, Durhmarš, Paver,
- rezultat tekme do 25 (ali poljubnega cilja 7–99),
- ročni popravek rezultata za gostitelja,
- klepet, ponovna povezava z istega brskalnika,
- PWA osnova za namestitev na domači zaslon.

## Zagon na računalniku

Potrebujete Node.js 18 ali novejši.

```bash
npm install
npm start
```

Nato odprite `http://localhost:3000`.

## Kako omogočiti pravo online igranje prek interneta

To NI statična stran, ker pravo večigralsko igranje potrebuje strežnik. Celotno mapo lahko objavite na kateremkoli Node.js ponudniku, ki podpira WebSocket povezave, na primer Render, Railway, Fly.io ali lasten VPS.

- Build command: `npm install`
- Start command: `npm start`
- Port: aplikacija uporablja `process.env.PORT`, zato je primerna za večino hostingov.

Po objavi vsi odprejo isto HTTPS povezavo, eden ustvari sobo, ostali vpišejo kodo.

## Pomembno o pravilih

Šnops ima veliko regionalnih/hišnih različic. Ta projekt uporablja slovensko različico, kjer se igra z 20 kartami, pri 4 igralcih se rufa karta in partner, pri 3 igralcih je talon, pri štihu pa veljajo barvanje, preštihanje in adut. Posebne igre so implementirane po eni pogosti različici, vendar jih boste morda želeli prilagoditi družinskim pravilom.

Najpomembnejše konstante so na vrhu `server.js` v objektu `CONTRACTS`. Logika posebnih iger je v `evaluateSpecial()`, logika navadne igre pa v `evaluateNormal()`.

## Produkcijske izboljšave

Za resnejšo javno uporabo priporočam še:

1. trajno shranjevanje sob/rezultatov v Redis ali PostgreSQL,
2. več strežniških instanc + Socket.IO Redis adapter,
3. prijavo uporabnikov ali vsaj podpisane sejne žetone,
4. testni paket za vsa pravila in robne primere,
5. nastavitev hišnih pravil pred začetkom sobe,
6. animacije kart, zvoke in SVG/PNG podobe slovenskih kart, če jih želite.

## GitHub + Render, korak za korakom

Za pripravljene ukaze za GitHub in natančen postopek objave na Render glejte [`DEPLOY.md`](DEPLOY.md).
