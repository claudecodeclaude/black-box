# Sales Calls — Setup

## 1. Mac Mini launchd service

Drop this plist at `~/Library/LaunchAgents/com.jason.sales-calls.plist`, then load it. Pick a random `SC_TOKEN` — the iPhone Shortcuts and the Apex App proxy both need to use the same value.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jason.sales-calls</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/jasonslagel/projects/black-box/scripts/sales-calls/server.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_EXTRA_CA_CERTS</key>
    <string>/opt/homebrew/etc/ca-certificates/cert.pem</string>
    <key>SC_HOST</key>
    <string>100.74.13.60</string>
    <key>SC_PORT</key>
    <string>7687</string>
    <key>SC_TOKEN</key>
    <string>REPLACE_WITH_RANDOM_HEX</string>
    <key>SC_CERT</key>
    <string>/Users/jasonslagel/.apex-certs/cert.pem</string>
    <key>SC_KEY</key>
    <string>/Users/jasonslagel/.apex-certs/key.pem</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key>
  <string>/Users/jasonslagel/Library/Logs/sales-calls.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/jasonslagel/Library/Logs/sales-calls.err.log</string>
</dict>
</plist>
```

Load and verify:

```bash
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.jason.sales-calls.plist
curl -sk https://jasons-mac-mini-1.taile58089.ts.net:7687/api/health
```

After editing `server.mjs`, restart with `launchctl kickstart -k gui/$UID/com.jason.sales-calls` (matches the pattern documented for the other Apex services).

## 2. Apex App env vars

The Apex App proxies the browser's read requests through to this helper so the page stays same-origin. Add these to the apex-app launchd plist's `EnvironmentVariables` dict:

```xml
<key>APEX_SC_HELPER</key>
<string>https://jasons-mac-mini-1.taile58089.ts.net:7687</string>
<key>APEX_SC_TOKEN</key>
<string>SAME_TOKEN_AS_SC_TOKEN_ABOVE</string>
```

Then `launchctl kickstart -k gui/$UID/com.jason.apex-app` to pick it up.

## 3. iPhone Shortcut — "Send Sales Call"

Run this once after a sales call to ship Apple's transcript to the Mac Mini.

**Build it manually in Shortcuts on iPhone:**

1. New Shortcut named "Send Sales Call". Toggle on **Show on Share Sheet**, **Show in Action Button**.
2. Action: **Ask for Input** → "Doctor's name (full name as you'll remember them)" → save as `DoctorName`.
3. Action: **Get File from Folder** → navigate to the Notes app's call recording (the share sheet flow can also pass the note as input — see step 7).
4. Action: **Get Text from Input** → extract the transcript text from the Notes note.
5. Action: **Dictionary** with these keys:
   - `doctorName` → `DoctorName`
   - `transcript` → transcript text from step 4
6. Action: **Get Contents of URL**
   - URL: `https://jasons-mac-mini-1.taile58089.ts.net:7687/api/ingest`
   - Method: `POST`
   - Request Body: JSON, set to the Dictionary from step 5
   - Headers: `Authorization: Bearer <SAME_SC_TOKEN>`, `Content-Type: application/json`
7. **Easier flow:** From the Notes app, open the call note, tap Share, pick "Send Sales Call". The note text becomes the input automatically; the Shortcut prompts only for the doctor's name and ships it.

**Optional audio upload:** add a step that gets the audio attachment from the note, encodes it as Base64, and adds it to the dictionary as `audioBase64`. Skipping this is fine — Apple's transcript is what drives extraction.

## 4. iPhone Shortcut — "Add Thoughts"

After hanging up, record your own thoughts about the call and append them to that doctor's record.

1. New Shortcut named "Add Thoughts".
2. Action: **Ask for Input** → list, show every pending/recent record from `GET https://...:7687/api/records` and let you pick by doctor name + date. (Easier first version: just **Ask for Input** for the record's ID — copy/paste from the Apex App page.)
3. Action: **Record Audio** → save as `Audio`.
4. Action: **Base64 Encode** the audio.
5. Action: **Dictionary** with `audioBase64` → Base64 encoded audio, `audioMimeType` → `audio/m4a`.
6. Action: **Get Contents of URL**
   - URL: `https://jasons-mac-mini-1.taile58089.ts.net:7687/api/thoughts/<recordId>`
   - Method: `POST`
   - Body: JSON from step 5
   - Headers: `Authorization: Bearer <SAME_SC_TOKEN>`, `Content-Type: application/json`

Whisper on the Mac Mini transcribes it and appends to the record's thoughts section, clearly separated from the doctor's words.

## 5. Smoke test

```bash
# Health check
curl -sk https://jasons-mac-mini-1.taile58089.ts.net:7687/api/health

# Fake ingest
curl -sk -X POST https://jasons-mac-mini-1.taile58089.ts.net:7687/api/ingest \
  -H "Authorization: Bearer $SC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"doctorName":"Dr. Test","transcript":"This is a test transcript."}'

# Should appear in Apex App at /apps/sales-calls/ as a pending record.
```
