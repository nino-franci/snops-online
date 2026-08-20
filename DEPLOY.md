# Objavi Šnops Online: GitHub + Render

Ta projekt potrebuje Node.js strežnik in WebSocket povezave (Socket.IO), zato ga ne objavljaj samo z GitHub Pages. GitHub naj hrani kodo, Render pa naj poganja aplikacijo.

## 1. Ustvari GitHub repozitorij

Na GitHubu ustvari nov **Public** repozitorij, npr. `snops-online`.

V terminalu odpri mapo projekta in zaženi:

```bash
git init
git add .
git commit -m "Initial Snops Online"
git branch -M main
git remote add origin https://github.com/TVOJ-UPORABNIK/snops-online.git
git push -u origin main
```

Zamenjaj `TVOJ-UPORABNIK` s svojim GitHub uporabniškim imenom.

## 2. Preveri, kaj gre na GitHub

V repozitoriju naj bodo vsaj:

```text
snops-online/
├── public/
│   ├── app.js
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── style.css
│   └── sw.js
├── .gitignore
├── DEPLOY.md
├── package.json
├── README.md
├── render.yaml
└── server.js
```

`node_modules/` in `.env` ne nalagaj na GitHub; `.gitignore` ju že izključi.

## 3. Objavi na Render

1. Prijavi se v Render.
2. Izberi **New > Blueprint** (najlažje, ker projekt že vsebuje `render.yaml`).
3. Poveži svoj GitHub račun in izberi repozitorij `snops-online`.
4. Render bo iz `render.yaml` prebral:
   - runtime: Node,
   - build: `npm install`,
   - start: `npm start`,
   - health check: `/health`.
5. Potrdi ustvarjanje servisa.

Lahko uporabiš tudi **New > Web Service** in ročno nastaviš:

```text
Build command: npm install
Start command: npm start
Health check path: /health
```

Porta ni treba ročno nastavljati. Strežnik uporablja `process.env.PORT`, ki ga Render poda sam.

## 4. Uporabi javni URL

Ko je deploy uspešen, bo Render prikazal HTTPS naslov, podoben:

```text
https://snops-online.onrender.com
```

Ta isti URL odpre vsak družinski član na svojem telefonu. Eden ustvari sobo, drugim pošlje kodo ali povezavo.

## 5. Posodobitve igre

Ko kasneje spremeniš kodo:

```bash
git add .
git commit -m "Posodobitev igre"
git push
```

Če ima Render vključen Auto-Deploy, bo nova verzija samodejno objavljena po `git push`.

## Varnost pri public repozitoriju

V GitHub nikoli ne commitaj gesel, API ključev ali drugih skrivnosti. Če jih bo aplikacija kdaj potrebovala, jih nastavi kot Environment Variables v Renderju in jih lokalno hrani v `.env` (ki je že v `.gitignore`).

## Če ne želiš uporabljati terminala

Projekt lahko na GitHub naložiš tudi prek spletnega vmesnika: ustvari prazen Public repo in vanj naloži vse datoteke iz razpakirane mape. Pomembno je, da so `package.json`, `server.js` in `render.yaml` neposredno v korenu repozitorija, ne v dodatni podmapi.

## Opomba za Render Free

Render Free Web Service se po obdobju nedejavnosti lahko uspava. Prvi obisk po premoru lahko zato potrebuje nekaj časa, da se strežnik ponovno zažene. Za družinsko igranje je Free dovolj za začetek; za stalno takojšnjo odzivnost lahko kasneje izbereš plačljiv instance type.
