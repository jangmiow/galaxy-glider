# Galaxy Glider 🚀

A browser-based space exploration game where you pilot a ship through the cosmos, discover planets, and build your pilot profile. Built as a personal project to scratch a very specific itch: what if a spaceship actually flew like a spaceship?

---

## What it is

Galaxy Glider is a fully client-side space game with real momentum-based flight physics. Your ship doesn't just move when you press a key and stop when you let go. It drifts, it carries speed, it takes effort to brake. Flying it feels like flying something.

The game runs in the browser with no install, no account, and no server. Everything is saved locally in your browser.

---

## How to play

- Create a pilot profile with your callsign (a 4-digit code unlocks the roster: the default is `1234`)
- Each pilot has their own discovery journal, score, rank, and surveyed-system medals
- Fly through the galaxy, identify planets, and log your discoveries
- Your progress saves automatically per pilot

Multiple pilots can share one device, each with their own save data kept separate.

---

## Built with

- React + TypeScript
- Vite
- Fully client-side: no backend, no API, no database
- All save data stored in localStorage (stays in your browser, goes nowhere)

---

## Run it locally

```bash
git clone https://github.com/jangmiow/galaxy-glider.git
cd galaxy-glider
npm install
npm run dev
```

Then open `http://localhost:5173` in your browser.

---

## Background

Built as a birthday project. The brief was: a space game with real flight physics, planet discovery, and a way for 2 people to keep separate save files on the same device. The passcode system is a soft household gate, not a security feature, just enough friction to keep save data separate between pilots.

The physics were the interesting bit to get right.

---

## Licence

MIT. Take it, break it, rebuild it.
