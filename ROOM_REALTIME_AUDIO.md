# Live microphone audio

## Release boundary
Frontend PR #1 was merged as `78eb7f9e` and deployed on 28 October 2026.
Backup: `/opt/3dtalks-backups/3dtalks-20261028T145216Z`; room, object, seat and
template hashes were unchanged. Rollback image: `3dtalks:before-compat-78eb7f9e`.
Realtime work starts independently in `codex/realtime-voice` from this merge.

## Architecture
LiveKit SFU, audio only: server 1.13.11, client SDK 2.23.0, server SDK 2.19.2.
Bundle the client locally with esbuild and its licence. Keep existing Express,
PostgreSQL and room WS for admission, chat, seats and presentations. No mesh,
Redis, camera, recording or egress in this single-node trial. A six-person mesh
needs fifteen peer links and complicates future server enforcement.

References: [deployment](https://docs.livekit.io/transport/self-hosting/deployment/),
[ports](https://docs.livekit.io/transport/self-hosting/ports-firewall/),
[tokens](https://docs.livekit.io/frontends/reference/tokens-grants/),
[server SDK](https://docs.livekit.io/reference/server-sdk-js/).
Token expiry does not close established sessions; self-hosted participant removal
does not invalidate existing JWTs. The admission gate is therefore mandatory.

## Admission
Grant only after verified live WS admission with an active seat/current epoch.
Server-generated media room and identity bind to that exact connection. Allow
microphone publication/subscription only, no camera, screen, data, metadata edits
or administration. JWT TTL 60 seconds; keep it only in browser memory.

Nginx exposes only RTC paths, verifies JWT plus current application admission on
every new signaling connection and disables query-string logging. Server APIs
remain private. Leave, replacement, expired seat, ended room and disconnect revoke
the identity and remove the SFU participant. A bounded, non-overlapping periodic
reconciliation removes stale participants, including after application restart.
SDK calls have deadlines. Legacy clips cannot run beside realtime; no silent
downgrade on SFU failure. The server advertises the mode after admission.

## Client
Microphone starts off on entry/reload/reconnect. Click toggles continuous speech;
click again cancels permission/publication. Incoming audio mute is independent.
Disable device selection/local microphone test while capturing or requesting.
Use echo cancellation/noise suppression/automatic gain control and exact selected
device; missing devices fail visibly rather than silently changing microphone.

States: connecting, muted, requesting, publishing, recovering, failed, stopped.
Generation guards invalidate late asynchronous operations. Network recovery stops
capture and never restores microphone intent. Bounded retries plus manual retry;
autoplay rejection exposes an enable-audio button. No local speaker monitoring.
Clean up SDK listeners, audio elements, tracks, nodes and timers on exit.
Analyse actual received audio and local capture for mouths, with existing gain,
noise gate and smoothing. Muted incoming audio does not animate as audible speech.
Roster labels describe live media rather than recording a voice message.

## VPS
The trial VPS has approximately 1 GiB RAM: one capped audio SFU, existing app and
PostgreSQL; measure actual consumption. Do not enable PPTX conversion or video
conferencing. Signaling uses trusted HTTPS under `/livekit/`; API 7880 stays
private. ICE UDP 7882, ICE TCP 7881 and authenticated embedded TURN UDP 443 provide
NAT traversal and a TCP fallback. Corporate networks permitting only TCP 443 need
TURN/TLS with a separate hostname/certificate or proxy arrangement; do not claim
universal connectivity. Preserve existing HTTPS and explicit firewall rules.

## Verification and rollout
Check admission denial, room/identity/source grants, replay after lost admission,
every revoke path and reconciliation retries. Two real SDK browser sessions must
receive RTP/audio before the sender stops, support simultaneous speech, microphone
and speaker mute, recovery without capture, late permission cancellation,
autoplay recovery, mouth animation, room isolation and teardown. Force TURN relay
in a bounded separate check. Run relevant room/presentation regressions.
These checks do not establish physical microphone quality or every network.

Commit reviewed stages and push the separate branch. Before deployment preserve
image/ref/environment and normal data backup. Deploy SFU behind admission gate
before enabling client mode. Verify HTTPS/readiness/media/memory. Roll back mode
and image on failure; never restore the database automatically or alter snapshots.
