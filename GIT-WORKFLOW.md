# Git workflow - brez rocnega uploadanja na GitHub

## Prvic
Najlazje z GitHub Desktop:
1. Namesti GitHub Desktop: https://desktop.github.com/
2. File -> Clone repository.
3. Izberi `nino-franci/snops-online` in lokalno mapo.
4. Datoteke te verzije kopiraj v TO klonirano mapo in potrdi zamenjavo.
5. V GitHub Desktop: Commit to main -> Push origin.

Alternativa v terminalu:
```bash
git clone https://github.com/nino-franci/snops-online.git
cd snops-online
```
Potem kopiras posodobljene datoteke v to mapo in:
```bash
git add -A
git commit -m "Update Snops Online"
git push origin main
```

## Vsaka naslednja sprememba
Ce delas v klonirani mapi, ni vec ZIP uploadov. Uporabi GitHub Desktop (Commit + Push) ali dvoklikni `PUSH_CHANGES.bat`.
Render ob pushu na `main` sam naredi nov deploy, ce je Auto-Deploy vklopljen.
