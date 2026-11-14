# Chrome Web Store listing

## Name

- pt-BR: **Zarpa Party — assista junto com os amigos**
- en: **Zarpa Party — watch together with friends**

## Short description (max 132 characters)

- pt-BR (118): Assista junto à distância: play, pause e pulo sincronizados com chat na Netflix, YouTube, Prime Video, Disney+ e mais.
- en (119): Watch together from anywhere: synced play, pause and seek plus chat on Netflix, YouTube, Prime Video, Disney+ and more.

## Category

Entertainment (Lifestyle > Entertainment). Language: Portuguese (Brazil) and English.

## Full description (pt-BR)

Filme é melhor com companhia. O Zarpa Party sincroniza o vídeo entre você e seus amigos e coloca um chat ao lado da tela, para assistir junto mesmo cada um na sua casa.

COMO FUNCIONA
1. Abra um filme, série ou vídeo.
2. Clique no ícone do Zarpa Party e em "Criar Party". O link de convite já vai para a área de transferência.
3. Mande o link. Quem abrir entra na party automaticamente.

O QUE VOCÊ GANHA
• Play, pause, pulo e velocidade sincronizados para todo mundo
• Correção automática de atraso: ninguém fica segundos na frente
• Chat lateral com apelidos, avatares coloridos e reações com emoji que flutuam sobre o vídeo
• Avisos do que acontece: "Ana pausou em 12:34", "João entrou"
• Modo "só o anfitrião controla", para ninguém pausar sem querer
• Funciona em tela cheia e tem atalho de teclado (Alt+Shift+Z)
• Reconecta sozinho se a internet oscilar

SITES COMPATÍVEIS
Netflix, YouTube, Prime Video, Disney+, Max, Crunchyroll, Globoplay, Paramount+, Apple TV+, Twitch e Vimeo. Em outros sites com vídeo, clique em "Ativar neste site".

PRIVACIDADE
Sem cadastro, sem anúncios, sem rastreamento. As mensagens e os eventos do vídeo são entregues em tempo real aos participantes da party e não ficam guardados em lugar nenhum.

IMPORTANTE
Cada participante precisa ter a extensão instalada e sua própria conta no serviço de streaming. O Zarpa Party não transmite o vídeo: ele apenas sincroniza o player de cada um.

Zarpa Party é um projeto independente, sem vínculo com os serviços de streaming citados.

## Full description (en)

Movies are better with company. Zarpa Party keeps the video in sync between you and your friends and puts a chat next to the screen, so you can watch together from different places.

HOW IT WORKS
1. Open a movie, show or video.
2. Click the Zarpa Party icon and "Create Party". The invite link is copied for you.
3. Send the link. Whoever opens it joins the party automatically.

WHAT YOU GET
• Play, pause, seek and speed synced for everyone
• Automatic drift correction: nobody ends up seconds ahead
• Side chat with nicknames, coloured avatars and emoji reactions floating over the video
• Activity notes: "Ana paused at 12:34", "João joined"
• "Only the host controls" mode, so nobody pauses by accident
• Works in fullscreen and has a keyboard shortcut (Alt+Shift+Z)
• Reconnects by itself when the connection drops

SUPPORTED SITES
Netflix, YouTube, Prime Video, Disney+, Max, Crunchyroll, Globoplay, Paramount+, Apple TV+, Twitch and Vimeo. On other sites with video, click "Enable on this site".

PRIVACY
No sign-up, no ads, no tracking. Messages and playback events are delivered in real time to the party members and are not stored anywhere.

IMPORTANT
Every participant needs the extension and their own account on the streaming service. Zarpa Party does not stream the video: it only keeps each person's player in sync.

Zarpa Party is an independent project, not affiliated with the streaming services mentioned.

## Single purpose

Zarpa Party has one purpose: letting a group of people watch the same online video in sync, with a chat alongside it. Every feature (playback synchronization, invite links, chat sidebar, participant list) serves that purpose.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `storage` | Saves the nickname the user chose so it is remembered between parties. Nothing else is stored. |
| `activeTab` | Lets the popup read the address of the tab the user is on when they click the icon, to offer "Enable on this site" for that exact site. |
| `scripting` | After the user grants a site with "Enable on this site", injects the same content scripts there and registers them so invite links keep working after a reload. Only files packaged in the extension are injected. |
| Host access to the listed streaming sites (content scripts) | Needed to find the video player on those pages, read and control playback (play, pause, seek, speed) and render the chat sidebar. `all_frames` is used because some players live in an iframe. |
| `optional_host_permissions: <all_urls>` | Never requested at install. Requested one origin at a time, only when the user clicks "Enable on this site", to support video sites that are not on the built-in list. |
| MAIN-world script on netflix.com | Netflix's player can only be seeked safely through its own page API; a small packaged script calls that API when the content script asks. |

**Remote code**: none. All code is packaged; the extension only opens a WebSocket to Supabase Realtime to exchange JSON messages.

## Data usage disclosures (Privacy practices tab)

- Collected/transmitted: "Personal communications" (chat messages) and "Website content" is not collected; "User activity" limited to playback events inside a party. Mark chat messages and the nickname as transmitted for the app's core functionality.
- Not sold, not used for unrelated purposes, not used for creditworthiness or lending.
- Privacy policy URL: public URL where `PRIVACY.md` is hosted.

## Assets

- Icon 128x128: `icons/icon128.png`
- Small promo tile 440x280: `store/promo-440x280.png`
- Screenshots (1280x800 or 640x400, at least one): to be captured from a real party (sidebar open next to a video, and the popup).
