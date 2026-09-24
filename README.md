# Secret Bear 🐻

A private, phone-first, real-time social deduction game for 5–10 friends. Everyone joins the same room from a browser while talking over FaceTime/Discord.

## What it includes

- Five-character private room codes
- 5–10 players
- Hidden role assignment and private role knowledge
- Honey Bear / Grizzly / Secret Bear teams
- Live President + Chancellor nomination
- Simultaneous public voting
- Secret three-card / two-card legislative flow
- Failed-government chaos tracker
- Player-count-specific presidential powers
- Investigation, policy peek, special election, and banishment
- Veto power after five Grizzly policies
- Correct major win conditions
- Reconnection tokens so a phone refresh can reclaim the same seat
- Mobile-first UI designed to sit beside a FaceTime call
- In-memory rooms that expire after everyone has been disconnected for two hours

## Run it locally

Requires Node.js 18+.

```bash
npm start
```

Then open `http://localhost:3000`.

To test with multiple players on one computer, open several private/incognito browser windows. For phones on the same Wi-Fi, use your computer's LAN IP (for example `http://192.168.1.20:3000`) and make sure your firewall allows the port.

## Put it online for distant friends

This project has **zero npm dependencies** and is ready for a normal Node.js host such as Render, Railway, Fly.io, or a small VPS.

Typical deploy settings:

- Build command: none (or `echo "No build step"`)
- Start command: `npm start`
- Runtime: Node.js 18+
- Port: supplied automatically through the `PORT` environment variable

The app stores active game rooms in server memory. That is perfect for casual private game nights, but a server restart will end active rooms. If you later want persistent games or multiple server instances, move room state to Redis or another shared datastore.

## Game naming

This adaptation uses:

- **Honey Bear** = majority team role
- **Grizzly** = hidden team role
- **Secret Bear** = hidden special leader role
- **Honey Policy** / **Grizzly Policy** = policy tracks
- **Banishment** = elimination power

## Attribution / license

This is an unofficial, noncommercial adaptation of **Secret Hitler**, created by Mike Boxleiter, Tommy Maranges, and Mac Schubert.

The original game is licensed under **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**. This adaptation is provided under the same license. It uses original code, wording, and bear-themed presentation rather than the original game's artwork.

Original game: https://www.secrethitler.com/
License: https://creativecommons.org/licenses/by-nc-sa/4.0/

Do not sell this adaptation or submit it to an app store without independently checking the original game's license terms.
