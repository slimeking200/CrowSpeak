# Crow Call Translator Pro (Web)

Crow Call Translator Pro is a mobile-optimized progressive analytics console for interpreting American crow (Corvus brachyrhynchos) vocalizations in real time. It pairs the Web Audio API with field-tested heuristics to detect call bursts, categorise them with confidence scoring, and narrate plain-language translations on demand.

## Professional Feature Set

- Adaptive signal processing with configurable sensitivity, ambient calibration, and live RMS readouts for outdoor deployment.
- Ten behaviour-backed vocal classes covering alarm, assembly, recruitment, juvenile, and roosting contexts with per-category knowledge cards.
- Confidence gating and cooldown controls to tune reporting cadence for research, wildlife education, or citizen science.
- Session analytics dashboard highlighting burst rate, session duration, ambient noise baseline, median spacing, and per-category counts.
- Crow Dialogue Studio enables two-way communication with broadcast-ready call sequences while muting self-triggered detections.
- Real-time TTS narration with voice selection, optional verbose explanations, and automatic logging to an exportable CSV.
- Mobile-first responsive UI with touch-friendly controls, log auto-scroll, and theme-aware styling for daylight or night surveys.

## Quick Start (Mobile or Desktop)

1. Serve the project directory over **HTTPS**. Example: npx http-server -S -C cert.pem -K key.pem from the project root, or any static hosting provider supporting TLS.
2. Visit https://<your-host>/index.html on the device you will use for field recording.
3. Tap **Start Analyzing**, grant microphone permission, and (optionally) run **Calibrate Ambient Noise** during 4 seconds of quiet to anchor the noise floor.
4. Choose a speech synthesis voice, tweak sensitivity/confidence sliders, and begin monitoring. The live meter, ambient baseline, and burst-per-minute counter update continuously.
5. Detected bursts appear in **Recent Interpretations** with confidence, metrics, and sourcing notes. Toggle **Auto speak results** or **Verbose narration** to control announcements.
6. Export findings anytime via **Download log**, producing a CSV with timestamps, labels, acoustic measurements, and translations.
7. Launch **Crow Dialogue Studio** to broadcast preset calls; adjust repeats, spacing, and gain while the translator auto-mutes its own detections to prevent feedback.

> **Tip:** iOS Safari requires an extra tap after granting mic access to unlock audio playback and TTS. Leave the page open in the foreground; background tabs will pause capture.

## Two-Way Broadcast

- The preset picker in Crow Dialogue Studio maps directly to the behavioural categories above; the description references expected field usage.
- `Repeats`, `Intra-repeat spacing`, and `Broadcast gain` sliders let you tailor cadence and loudness to the moment. Start conservative and escalate only when birds are receptive.
- While a sequence plays, live classification is automatically suppressed and resumes about half a second after the final call.
- Knowledge base cards include a quick *Broadcast preset* button for rapid back-and-forth replies.
- Portable speakers aimed away from the device microphone help keep playback clear; the suppression guard handles the rest.


## Acoustic Intelligence

The classifier blends amplitude envelopes, inter-call timing, dominant frequency, and spectral band ratios. Each burst is scored against a growing knowledge base summarised below:

| Category | Translation | Acoustic signature | Behavioural context |
| --- | --- | --- | --- |
| Hawk sentinel alarm | Hawk overhead, stay hidden! | 3-8 prolonged caws, centroid 580-950 Hz, high harmonics | Perched lookout tracking hawks overhead (Verbeek & Caffrey 2002; Kilham 1989) |
| Alarm rally | Danger nearby! Everyone mob the threat! | Rapid spacing (<0.32 s) and harsh overtones | Community predator mobbing recruitment |
| Ground predator scold | Terrestrial threat spotted, hold position! | 3-7 firm caws, spacing 0.32-0.65 s, limited highs | Fox, raccoon, or human near nests |
| Territorial scold | Back off, this nesting territory is defended! | 6+ moderate caws, spacing 0.35-0.75 s | Boundary defence against corvids/mammals |
| Assembly call | Group up with me at this spot. | 4-6 moderate calls, spacing <= 0.55 s | Family regrouping prior to travel or foraging |
| Food discovery call | Fresh food here, come share! | 3-7 upbeat calls, centroid 420-640 Hz, lively highs | Recruitment to carcasses/crops (Marzluff & Heinrich 1991) |
| Contact call | Where are you? Keep checking in! | 1-3 calls, spacing >= 0.28 s, mellow spectrum | Low-level location pings while roaming |
| Juvenile begging | I need food over here! | >=5 short, nasal calls, centroid >= 500 Hz | Dependent fledglings soliciting feedings |
| Flight coordination | Change course with me now! | 3-6 quick calls, spacing 0.15-0.35 s | Flocks re-aligning mid-flight |
| Roost assembly | Dusk meet-up forming now! | >=8 calls, spacing 0.25-0.6 s | Pre-roost rally before communal roosting (Marzluff & Angell 2005) |

Every interpretation surfaces a detailed behaviour note plus key metrics (call count, mean duration, spacing, dominant frequency) for rapid vetting.

## Controls & Calibration

- **Sensitivity slider:** Adjusts the delta above the noise floor required to trigger detection. Lower values suppress urban noise; higher values capture faint distant calls.
- **Confidence filter:** Raises the minimum classifier confidence. Start around 45% and tweak upward when working in mixed-species soundscapes.
- **Cooldown:** Ensures minimum spacing between spoken announcements to avoid overlapping interpretations.
- **Calibration:** Samples ambient RMS for four seconds to reset the adaptive noise floor; repeat when moving between habitats or wind conditions.
- **Crow Dialogue Studio controls:** Choose a preset, set repeats, spacing, and gain before broadcasting; suppression automatically masks the translator mic during playback.
- **Voice & narration:** Select any available English TTS voice. Verbose mode appends behavioural rationale to translations for teaching moments.

## Logging & Data Handling

- **Session log:** Maintains up to 250 recent bursts with full metadata. Clearing the log also resets category counts and burst-rate history.
- **Broadcasts:** Playback sessions are not logged as detections; suppression keeps the interpretation log focused on wild responses.
- **CSV export:** Columns include ISO timestamp, label, confidence, translation, mean duration, average interval, dominant frequency, and peak RMS.
- **Per-category stats:** Auto-updating table tracks frequency and last-seen time stamp per vocal class for quick situational awareness.

## Testing & Validation

- **Bench testing:** Play curated Macaulay Library recordings or Cornell Lab sample packs to verify each category’s trigger ranges.
- **Field shakedown:** Try dawn/dusk roosts, nest monitoring, or agricultural edges. Log false positives and adjust sensitivity/confidence accordingly.
- **Maintenance:** Periodically reload the page to refresh permissions and voice lists; browsers may revoke microphone access after long idle periods.

## Known Limitations

- Heuristic scores are derived from published ranges and long-term observations; edge cases, mimicry, or overlapping species can mislabel calls.
- Browser TTS availability varies (Chrome/Edge/iOS Safari recommended). Android Firefox may require enabling speechSynthesis in about:config.
- Crow Dialogue Studio output depends on your speaker placement and volume; overly loud playback can still leak into the mic despite suppression.
- Requires an HTTPS origin and active tab to keep microphone streams alive; offline caching is not bundled.

## License

MIT. Adapt the heuristics, UI, or research notes to suit your project or expand to other corvid species.
