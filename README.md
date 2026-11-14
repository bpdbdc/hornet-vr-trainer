# Hornet VR Trainer — F/A-18C (Meta Quest 3, WebXR)

Simulateur d'entraînement **cockpit complet** du F/A-18C, calé sur le comportement du **module DCS**, à lancer dans le navigateur du Quest 3 (ou d'un PC).

- Cockpit **1:1 F/A-18C Lot 20** issu du modèle de référence **OpenHornet**, avec les vraies plaques de légende, éclairage des panneaux (CONSOLES / INST PNL), mode nuit, verrière animée, combiner HUD.
- **Cold start en mode examen** : APU, ENG CRANK, allumage, ralenti, EGT, IFEI, alarmes, INS (8 min / STD HDG), FCS RESET / BIT, débrief détaillé.
- **Scénarios** (jet en route, systèmes prêts) : hot start au sol, air-air (CAP), air-sol (strike), navigation.
- **HUD collimaté** (NAV, A/A, A/G : ACM, TD box, DLZ, SHOOT, AIM-9, canon, CCIP / AUTO, JDAM, Maverick, HARM, laser).
- **Radar APG-73** : RWS / TWS / STT / ACM (BST, VACQ, WACQ, GACQ), L&S / DT2, LTWS, barres, azimut, PRF, portée, A/G MAP / GMT / SEA.
- **Armement** : AIM-9X, AIM-7M, AIM-120C, canon, Mk-82, GBU-12, GBU-38, AGM-65F, AGM-88C, page STORES, Master Arm / SIM, LOCK / SHOOT.
- **Capteurs** : pod Litening (vidéo IR, WIDE / NARO / ZOOM, ATRK / PTRK, laser TRIG, LST), autodirecteur Maverick (vidéo).
- **Guerre électronique** : ALR-67 (page EW, tonalités, voyants AI / SAM / CW / AAA), menaces qui tirent, leurres.
- **Radios** : COMM 1 / 2, AWACS DARKSTAR (bogey dope, picture), Link 16 sur la page SA.
- **HOTAS virtuel** sur les manettes Quest + **HOTAS clavier** sur PC.
- **Sons du cockpit** synthétisés (moteurs, APU, ECS, hydraulique, verrière, clics, tonalités AIM-9 / RWR, canon, voix d'alerte).

## Utilisation
Ouvrir la page GitHub Pages du dépôt dans le navigateur du Quest 3, puis **Entrer en VR**. Le détail des commandes est dans le panneau « Commandes » de la page.

- Manettes : viser + gâchette = vers l'avant / le haut / sens horaire, grip = inverse, B / Y = recentrer, A / X = panneau.
- HOTAS virtuel : appui **long** sur le clic du stick d'une manette (droite = manche, gauche = manette des gaz).
- Mains : appuyer du doigt, pincer + tourner le poignet pour les molettes.

## Construction
`.github/workflows/build.yml` récupère les données OpenHornet, convertit le STEP en glTF, plaque les légendes,
puis publie `app/` sur GitHub Pages. Rien de binaire n'est stocké dans le dépôt.

Aucun élément d'Eagle Dynamics (modèles, textures, sons) n'est utilisé : tout est reconstruit (géométrie OpenHornet, sons synthétisés).

Licence : CC BY-NC-SA 4.0 (voir `LICENSE.md`).
