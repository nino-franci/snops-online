# Šnops Online

Mobilna online igra Šnops za družinsko igranje na ločenih telefonih. Trenutna posodobitev vsebuje nova hišna pravila za **4 igralce / 2 na 2**.

## Kaj je vključeno za 4 igralce

- fiksni pari po sedežih: 1 + 3 proti 2 + 4
- predvig ali udarec po kartah
- rufanje barve aduta po prvih 3 kartah
- 5 kart na igralca
- licitacija: 6, 7, 9, 12, 18, 24
- Dalje in Višam, tudi čez več krogov licitacije
- kontra ×2, kontra nazaj ×3, do konca ×4
- Navadna igra z obveznim barvanjem, preštihanjem in adutom
- 20 / 40, ki se aktivira po osvojenem štihu ekipe
- gumb Štejem za ročno potrditev 66+
- Šnops (6), vključno z gumbom Zaprem
- Mali (7)
- Veliki (9)
- Veliki z aduti (12)
- Igra 18 in Igra 24
- ekipni rezultat do 25; poražena ekipa zapisuje vrednost runde
- Socket.IO sobe, ponovna povezava in klepet
- mobile-first vmesnik in prenovljen videz kart

## Karte

Moč: `J < Q < K < 10 < A`

Točke: `J=2, Q=3, K=4, 10=10, A=11`

## Zagon lokalno

```bash
npm install
npm start
```

Nato odpri `http://localhost:3000`.

## Render

Projekt je pripravljen za Render z datoteko `render.yaml`. Repo poveži kot Blueprint ali Web Service. Po vsakem pushu na GitHub lahko Render samodejno ponovno objavi aplikacijo.

## Pomembno

Pravila za **3 igralce** bomo definirali posebej. Zato je možnost ustvarjanja nove 3-igralne sobe v trenutnem uporabniškem vmesniku označena kot »kmalu« in izklopljena.
