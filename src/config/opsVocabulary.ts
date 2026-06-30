// Compact operational vocabulary passed as a hint section in the triage prompt.
// These are supporting signals only — not rules. The model must still find operational impact.
// Keep this file compact; it is embedded verbatim into every classification call.

export const OPS_VOCABULARY_PROMPT = `
## Vocabulary hints (supporting context — not rules)

Product and technology terms help identify the issue domain, but mentioning a term alone
does not make an email urgent. Always look for operational impact alongside vocabulary.

Smart locks / door locks:
Alfred, Yale, Assure Lock, SALTO, Dormakaba, E-Plex, Schlage, Latch, ICT Deadbolt, iLOQ, Igloo

Access control systems:
ICT, tSec, Protege, Protege WX, Protege GX, relay, reader, controller,
SALTO wall reader, Brivo, ACS, Kantech, KT-1, KT-2, KT-300, KT-400, KTES, EntraPass

Intercom / visitor entry:
Akuvox, Webvision, ButterflyMX, Swiftlane, Mircom, TX3,
intercom, call box, visitor access, buzz in, door phone

Cameras / security video:
CASE, Hanwha, Hikvision, Axis, Avigilon, Verkada, Eagle Eye,
camera, VMS, bullet camera, dome camera, fisheye, panoramic, PTZ

LPR / vehicle access:
LPR, license plate recognition, ANPR, Axis License Plate Verifier,
Avigilon LPR, Verkada LPR, license plate camera

HVAC / thermostat:
Nest, Ecobee, Honeywell, Resideo, Mysa,
thermostat, HVAC, heating, cooling

Leak / water:
Resideo, Honeywell L1, Honeywell L5, Symmons,
leak detector, water shutoff, water leak, valve

Vocabulary examples (right conclusion matters, not the term alone):
- "Yale lock quote attached"            → normal or not_relevant
- "Yale lock will not open, resident outside" → urgent, access_or_lockout
- "Brivo question for next week"        → normal, dashboard_only
- "Brivo reader down, people can't get in"   → urgent, access_control, post_to_ops_triage
- "Axis camera spec sheet"              → not_relevant
- "Axis cameras down, staff can't verify deliveries" → urgent, cameras_or_security_video
- "ButterflyMX install docs"            → not_relevant
- "ButterflyMX not letting visitors in today"  → urgent, access_control, post_to_ops_triage
- "ICT is acting weird"                 → maybe normal unless impact is clear
- "ICT acting weird, people can't buzz visitors in" → urgent, ict_or_intercom
`.trim();
