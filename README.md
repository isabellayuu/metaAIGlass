# NumLens

A math study aid for Meta Ray-Ban Display glasses, for students with dyslexia and dyscalculia.

Look at a math word problem and tap the glasses. NumLens turns it into 2–4 small steps, each with one simple color-coded picture and a short math strip like `6 × 4 = ?`. It never shows the final answer: the student works it out.

Built for Junction 2026, Meta challenge.

## The problem

Word problems are hard when reading is slow and holding numbers in memory is hard. Students spend their effort decoding the text instead of on the math. NumLens takes the reading load away: every step shows one idea, each quantity keeps the same color in the text and in the picture, and the unknown is always a green "?".

The glasses matter because the student keeps looking at their own paper. There is no phone to hold and no retyping.

## How it works

```
Glasses camera ──tap──▶ iPhone app (DAT) ──photo, faces blurred──▶ /api/recognize (Gemini)
                                                                          │
Glasses display ◀── picture + math strip per step ◀── steps, answer removed ┘
```

1. The iPhone app connects to the glasses with Meta's Device Access Toolkit (DAT).
2. Tapping **Scan** on the glasses takes a photo with the glasses camera.
3. The server sends it to Gemini, which plans the steps and diagrams as JSON. The server then removes the final answer from everything it returns.
4. The app draws each step and shows it on the glasses display. The wearer moves between steps with taps.

**Web app (backup).** The same recognition also runs in a web app. On a laptop or phone it watches the camera and draws the model over the problem. On the glasses, where web apps get no camera, the problem comes from Meta AI by voice ("Hey Meta, visualize this math problem", via WebMCP) or from dictation into a text field.

## Repository

| Folder | Contents |
|---|---|
| `ios/MathLens/` | iPhone app (Swift, DAT): glasses connection, camera, face blurring, glasses screens |
| `server/` | Recognition: Gemini prompt and schema, answer removal, text clean-up |
| `api/` | Vercel function for `POST /api/recognize` |
| `src/` | Web app (React, Meta Ray-Ban Display UI Toolkit) |

## Run it

### Server and web app

Requires Node.js 20 or later.

```sh
npm install
echo 'GEMINI_API_KEY=your-key' > .env.local
npm run build && npm run preview
```

Open http://127.0.0.1:4173/ and allow the camera. Add `?glasses=1` to hide the camera feed, as on see-through glasses.

To deploy, connect the repo to Vercel and set `GEMINI_API_KEY` under Environment Variables. Optionally set `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS` to choose models.

### iPhone app

Requires macOS 26.6+, Xcode 26.4+, iOS 17.2+, and Meta Ray-Ban Display glasses with Developer Mode turned on in the Meta AI app.

1. Open `ios/MathLens/MathLens.xcodeproj` in Xcode. The DAT package downloads automatically.
2. Under **Signing & Capabilities**, choose your own team.
3. Run on your iPhone, tap **Connect to Meta AI** to register the app, then **Connect glasses**.
4. The app uses `https://meta-ai-glass.vercel.app` by default; the server address can be changed in the app.

Without glasses, debug builds run in the iOS Simulator with simulated glasses, and **Demo mode** uses built-in example problems instead of the server.

## Privacy and safety

- Faces in a glasses photo are blurred on the phone before it is sent.
- Only that one photo is sent, and only when the wearer taps Scan. NumLens stores no photos; Gemini processes them under Google's API terms.
- The Gemini key stays on the server. The apps only know the server address.
- The final answer is removed on the server, so no app can show it.

## Limitations

- Supported problems: proportions, fractions, ratios, percentages, rates and comparing quantities.
- Web apps on the glasses cannot use the camera; only the iPhone app can.
- Recognition needs a network connection and a Gemini API key.
