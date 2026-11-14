# Zarpa Party - Privacy Policy

_Last updated: 2026-11-13_

Zarpa Party lets people watch videos in sync and chat while they do. It is built to work with as little data as possible.

## What is transmitted

While you are in a party, the extension sends the following to the other members of that party through Supabase Realtime (a message relay service):

- **Nickname** you chose (or the default "Visitante NN").
- **Chat messages and emoji reactions** you send.
- **Playback events**: play, pause, seek, playback speed and the current position of the video.
- **The address of the page you are watching**, only when you open a different video during a party, so the others can follow.
- A **random identifier** generated for the party session and the time you joined, used to list participants and pick the host.

Nothing is transmitted when you are not in a party.

## What is stored

- **On your device**: your nickname (`chrome.storage.local`) and, for the current tab only, the party you are in (`sessionStorage`), so a page reload does not drop you from the party.
- **On servers**: nothing. Messages are relayed in real time and are not saved to any database. There is no chat history: people who join later do not see earlier messages, and everything is gone when the party ends.

## What is never collected

- No account, e-mail, password or payment data.
- No browsing history. The extension only runs on the supported video sites and on sites you explicitly enable.
- No analytics, advertising, tracking or fingerprinting.
- No access to your streaming credentials or to the video content itself.
- Data is never sold or shared with third parties, and never used for purposes unrelated to watching together.

## Who can see party data

Anyone who has the party code or invite link can join and see what is sent while they are in it. Share invite links only with people you trust. Like any internet service, the relay provider (Supabase) processes connection metadata such as IP addresses to deliver messages; see <https://supabase.com/privacy>.

## Permissions

- **storage**: remember your nickname.
- **activeTab / scripting**: enable the extension on a site you choose with "Enable on this site".
- **Site access** to the supported streaming sites: detect and control the video player and show the chat sidebar.
- **Optional site access**: requested one site at a time, only when you click "Enable on this site".

## Contact

Questions or requests: open an issue in the project repository or write to the publisher address shown on the Chrome Web Store listing.
