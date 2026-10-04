# xhealth

A consumer health companion with a voice conversation screen, meal logging, and a combined report summary. Plain HTML, CSS, and JavaScript; Node's built-in HTTP server. Two small dependencies: `ws` connects live voice, and `text2wav` supplies local Hindi audio when the browser has no Hindi voice. No frontend framework, chart library or API SDK.

## Run

1. Install Node.js 20 or newer.
2. Run `npm install`, then `npm start` in this folder.
3. Open http://localhost:3000 for talking and logging.
4. Open http://localhost:3000/reports for charts.
5. Connection keys can be changed in **Settings → Local demo setup**. They are saved in the local server's ignored `.env` file.

PDF extraction uses Python, `pypdf` and `pypdfium2`: `python -m pip install pypdf pypdfium2`. Set `PYTHON_PATH` in `.env` if Python is not on PATH. The bundled Python path is configured on this computer. Pasted report text and TXT files work without Python. Both selectable-text and scanned PDFs are supported. Scanned pages are rendered in memory and transcribed with Groq's vision model (`qwen/qwen3.8-27b`). Check OCR values before saving. The complete extracted text is retained. Longer reports are analyzed in sections and their source-backed findings are used in chat. Password-protected files need an unlocked copy.

## Use

- **Talk:** tap **Speak**, then **Start talking**, and allow microphone access. Deepgram Flux Multilingual streams Hindi, Hinglish or English and detects finished turns automatically. The English/हिन्दी button at the top selects the language of both text and spoken replies. Replies play only while the top Audio toggle is on; the microphone resumes for the next turn. User transcripts and assistant replies stay in the chat and browser history. **Audio** at the top switches all playback on or off, including during voice conversations. **End conversation** releases the microphone; **Stop audio** skips playback. Hindi audio uses a device Hindi voice or a synthetic local eSpeak fallback. The reply language is independent of the Audio toggle and is saved locally.
- **Log a meal:** describe the foods and portions naturally, by text or voice. Groq routes each message using recent conversation and saved meals, without food keyword rules. Bare lists and Hindi/Hinglish work; questions and future plans remain chat. Explicit corrections update the identified saved meal. Missing sizes or added oil use stated assumptions; “a roti” counts as one. A follow-up is used only when no consumed food can be identified. Today's meal button shows estimates, not measured nutrition or prescribed targets. Meals persist in browser storage.
- **Food diary:** white cards show nutrient amounts, with a monochrome energy-mix chart. The ring uses approximate 4/4/9 kcal per gram factors, explained by the [USDA](https://www.nal.usda.gov/programs/fnic). It shows estimated shares of logged food energy, not a daily goal. Portion assumptions are expandable. The interface is black and white; report bars use a single green accent. Text labels identify above/below/in-range results without implying a diagnosis.
- **Reports:** tap **+**, upload a PDF/TXT or paste text, check the extracted values and report date, then **Save & analyze**. Raw text is saved even if analysis fails. Up to three reports, 8 MB per file, are supported by this prototype.
- **My health:** defaults to all saved reports, retaining the latest dated result per matching test and unit. It never averages blood tests. A short Groq summary and up to three practical recommendations use the selected reports, recent meals and conversation. Short test explanations and next steps come first; exact ranges, trends and sources are expandable. Single reports remain selectable. Common-test explanations cite MedlinePlus and NHLBI; cholesterol habit suggestions cite NHLBI and are general education. Disease-risk bars appear only for explicitly reported percentages. Analyze older reports to include their values in the combined view.
- **Meal planning / routine help:** ask naturally in the conversation. The assistant uses saved context and gives ordinary suggestions immediately, using stated portion assumptions.
- **New chat:** starts a fresh conversation, retaining reports and meal logs. The previous conversation can be restored from Settings.

## Read the code

- `public/index.html`: both page layouts and the small dialogs.
- `public/style.css`: minimal styling, mobile layouts, and labeled color cues for nutrients and report ranges.
- `public/voice.js`: continuous microphone session, automatic Flux turn handling, audible Hindi replies and cleanup. `public/microphone.js` collects 80 ms PCM audio chunks.
- `public/app.js`: browser storage, chat, speech playback, meal and report logging. Start with `handleMessage`, `askQuestion`, `logMeal`, and `saveReport`. `makeMealCard` and `nutrientCards` render plain-language nutrition receipts and the food diary.
- `public/reports.js`: `labGuide` supplies reviewed plain-language explanations, `drawNextSteps` supplies general habits, and `buildHealthSnapshot` keeps the latest matching results with source dates. `rangeStatus` compares values against the report's reference bounds; `renderReportPage` assembles the page.
- `server.js`: direct API calls. `understandMessage` asks Groq to route natural-language messages as chat, a new meal, or a correction to a saved meal. `streamReply` buffers Groq text into roughly 40-character chunks at word boundaries. `transcribeAudio` calls Deepgram; `synthesizeSpeech` uses local Hindi audio or Deepgram English. `estimateMeal` returns rough estimates with assumptions. `analyzeReport` extracts chart data and `validateReportInsights` checks quotes and numeric values against the original text.
- `extract_pdf.py`: reads PDF bytes from stdin, returns UTF-8 JSON text, and renders scanned pages in memory without saving the upload. `extractPdf` in the server transcribes scanned pages through Groq. `node verify-pdf.js` checks text, Unicode, scanned and invalid PDFs, plus a long report whose last-page result must appear in analysis and chat.
- `verify.js`: a manual smoke check using a synthetic voice sample and reference-range boundary checks. Run `node verify.js`; it makes small real API requests. `node verify-flux.js` checks a real Flux connection and two automatic spoken turns. `node verify-microphone.js` checks controls, history, playback and microphone cleanup with fakes; it never captures device audio. `npm run check` checks all JavaScript syntax.

## Limits and data

This is an automatic turn-based conversation using [Flux Multilingual](https://developers.deepgram.com/docs/flux/language-prompting). The microphone sends silence while the assistant responds to prevent speaker feedback; use Stop audio to interrupt. It does not support speaking over the assistant. Speech phrases are longer than the 40-character display chunks to keep playback natural. It does not use the Deepgram Voice Agent API.

Browser storage contains reports, meal logs and chats. **Clear saved data** deletes them. Report text and recent conversation/meal context go to Groq; microphone audio goes to Deepgram. English synthesis is still available through Deepgram. Hindi voice text uses device speech or the local speech engine; English text needing Hindi translation goes to Groq first. The server binds only to this computer, has no login or cloud database, and never sends API keys to the frontend.

Report extraction and meal estimates can be wrong: review the source and portions. A lab flag is not a diagnosis or disease probability. xhealth does not calculate clinical risk or invent reference ranges; a reported risk score still needs clinical interpretation. Meal planning is general education, not a therapeutic diet. No calorie target is prescribed.

Change `GROQ_MODEL` or `DEEPGRAM_VOICE` in `.env` and restart to use other available models.
