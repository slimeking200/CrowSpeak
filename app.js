
const ui = {
    button: document.getElementById("toggle-listen"),
    calibrate: document.getElementById("calibrate"),
    status: document.getElementById("status"),
    voiceSelect: document.getElementById("voice-select"),
    autoSpeak: document.getElementById("auto-speak"),
    verboseTts: document.getElementById("verbose-tts"),
    autoScroll: document.getElementById("auto-scroll"),
    levelMeter: document.getElementById("level-meter"),
    ambientLevel: document.getElementById("ambient-level"),
    burstRate: document.getElementById("burst-rate"),
    totalBursts: document.getElementById("total-bursts"),
    sessionDuration: document.getElementById("session-duration"),
    lastInterpretation: document.getElementById("last-interpretation"),
    translationLog: document.getElementById("translation-log"),
    downloadLog: document.getElementById("download-log"),
    clearLog: document.getElementById("clear-log"),
    confidenceDisplay: document.getElementById("confidence-display"),
    ambientRms: document.getElementById("ambient-rms"),
    medianSpacing: document.getElementById("median-spacing"),
    confidenceSlider: document.getElementById("confidence"),
    confidenceLabel: document.getElementById("confidence-label"),
    sensitivitySlider: document.getElementById("sensitivity"),
    sensitivityLabel: document.getElementById("sensitivity-label"),
    cooldownSlider: document.getElementById("cooldown"),
    cooldownLabel: document.getElementById("cooldown-label"),
    categoryTable: document.getElementById("category-stats"),
    knowledgeCards: document.getElementById("knowledge-cards"),
    calibrationIndicator: document.getElementById("calibration-indicator"),
    calibrationTimer: document.getElementById("calibration-timer"),
    playbackPreset: document.getElementById("playback-preset"),
    playbackRepeats: document.getElementById("playback-repeats"),
    playbackRepeatsLabel: document.getElementById("playback-repeats-label"),
    playbackSpacing: document.getElementById("playback-spacing"),
    playbackSpacingLabel: document.getElementById("playback-spacing-label"),
    playbackGain: document.getElementById("playback-gain"),
    playbackGainLabel: document.getElementById("playback-gain-label"),
    playbackPlay: document.getElementById("playback-play"),
    playbackStop: document.getElementById("playback-stop"),
    playbackStatus: document.getElementById("playback-status"),
    playbackDescription: document.getElementById("playback-description")
};


const localStorageKey = "crow-call-translator-settings";

const config = {
    fftSize: 2048,
    sampleBufferSize: 2048,
    baseStartDelta: 0.022,
    baseStopDelta: 0.013,
    startNoiseDelta: 0.022,
    stopNoiseDelta: 0.013,
    burstWindowSeconds: 3.2,
    burstGapSeconds: 0.68,
    minCallDuration: 0.06,
    maxCallDuration: 0.75,
    silenceRelease: 0.12,
    calibrationSeconds: 4,
    announcementCooldown: 5,
    minConfidence: 0.45
};

const defaultSettings = {
    sensitivity: 50,
    confidence: 45,
    cooldown: 5,
    autoSpeak: true,
    verboseTts: false,
    autoScroll: true,
    voiceURI: null
};

const settings = loadSettings();

let audioContext;
let analyser;
let processor;
let zeroGain;
let mediaStream;

const timeData = new Float32Array(config.fftSize);
const freqData = new Uint8Array(config.fftSize / 2);

const state = {
    listening: false,
    calibrating: false,
    calibrationEnd: 0,
    calibrationSum: 0,
    calibrationSamples: 0,
    noiseFloor: 0.02,
    lastRms: 0,
    callActive: false,
    callSilentFrames: 0,
    callFrames: 0,
    callRmsSum: 0,
    callMaxRms: 0,
    callDominantFreqSum: 0,
    callCentroidSum: 0,
    callHighRatioSum: 0,
    callMidRatioSum: 0,
    callLowRatioSum: 0,
    specSamples: 0,
    callStartTime: 0,
    callHistory: [],
    sessionLog: [],
    categoryStats: new Map(),
    intervalHistory: [],
    acceptedBurstTimes: [],
    sessionStart: null,
    lastAnnouncementTime: 0,
    levelSmoother: 0,
    ambientSmoother: 0,
    lastAnalyticsUpdate: 0,
    suppressDetectionUntil: 0
};

const CALL_PROFILES = [
    {
        id: "hawkSentinel",
        label: "Hawk sentinel alarm",
        translation: "Hawk overhead, stay hidden!",
        behavior: "Drawn-out, sharp caws warn flockmates of soaring raptors; sentinels keep family members under cover (Verbeek & Caffrey 2002; Kilham 1989).",
        acoustic: [
            "3-8 prolonged caws (0.18-0.45 s each)",
            "Spacing 0.28-0.55 s",
            "Dominant frequency 550-950 Hz",
            "High harmonic ratio > 0.45"
        ],
        match(features) {
            if (features.count < 3) return 0;
            let total = 0;
            let score = 0;
            const weigh = (value, weight = 1) => { total += weight; score += value * weight; };
            weigh(rangeScore(features.count, 3, 8, 2), 1.1);
            weigh(rangeScore(features.avgDuration, 0.18, 0.45, 0.2), 1.1);
            weigh(rangeScore(features.avgInterval || 0, 0.28, 0.55, 0.18), 1.1);
            weigh(rangeScore(features.centroidMean, 580, 950, 140), 1.2);
            weigh(rangeScore(features.highRatioMean, 0.45, 0.75, 0.2), 1.2);
            weigh(rangeScore(features.meanPeak, 0.09, 0.24, 0.08), 0.9);
            return total ? score / total : 0;
        }
    },
    {
        id: "alarmRally",
        label: "Alarm rally",
        translation: "Danger nearby! Everyone mob the threat!",
        behavior: "Rapid, harsh caws recruit neighbors to mob predators. Documented in numerous American crow alarm studies (Cornell Lab; Verbeek & Caffrey 2002).",
        acoustic: [
            "2+ intense caws",
            "Spacing < 0.32 s or high harmonic bite",
            "Peak RMS >= 0.11",
            "Dominant frequency 400-900 Hz"
        ],
        match(features) {
            if (features.count < 2) return 0;
            let total = 0;
            let score = 0;
            const weigh = (value, weight = 1) => { total += weight; score += value * weight; };
            weigh(rangeScore(features.meanPeak, 0.11, 0.26, 0.12), 1.2);
            weigh(rangeScore(features.highRatioMean, 0.38, 0.8, 0.25), 1.2);
            weigh(rangeScore(features.minInterval || 0, 0.12, 0.35, 0.1), 1.1);
            weigh(rangeScore(features.maxInterval || 0, 0.12, 0.6, 0.2), 0.8);
            weigh(rangeScore(features.centroidMean, 480, 1100, 260), 1.0);
            return total ? score / total : 0;
        }
    },
    {
        id: "groundThreat",
        label: "Ground predator scold",
        translation: "Terrestrial threat spotted, hold position!",
        behavior: "Medium-paced bouts target raccoons, foxes, and humans near nests. Birds remain perched and call with steady intensity (Kilham 1989).",
        acoustic: [
            "3-7 firm caws",
            "Spacing 0.32-0.65 s",
            "Dominant frequency 420-720 Hz",
            "High-harmonic ratio < 0.45"
        ],
        match(features) {
            if (features.count < 3) return 0;
            let total = 0;
            let score = 0;
            const weigh = (value, weight = 1) => { total += weight; score += value * weight; };
            weigh(rangeScore(features.meanPeak, 0.08, 0.2, 0.08), 1.0);
            weigh(rangeScore(features.avgInterval || 0, 0.32, 0.65, 0.2), 1.1);
            weigh(rangeScore(features.centroidMean, 450, 720, 180), 1.0);
            weigh(rangeScore(features.highRatioMean, 0.18, 0.42, 0.18), 1.0);
            weigh(rangeScore(features.count, 3, 7, 3), 0.9);
            return total ? score / total : 0;
        }
    },
    {
        id: "territorialScold",
        label: "Territorial scold",
        translation: "Back off, this nesting territory is defended!",
        behavior: "Persistent bursts warn off corvids and mammals from established nest trees (Kilham 1989; Marzluff & Angell 2005).",
        acoustic: [
            "6+ caws in a run",
            "Spacing 0.35-0.75 s",
            "Moderate intensity",
            "High band energy limited"
        ],
        match(features) {
            if (features.count < 6) return 0;
            let total = 0;
            let score = 0;
            const weigh = (value, weight = 1) => { total += weight; score += value * weight; };
            weigh(rangeScore(features.count, 6, 14, 4), 1.1);
            weigh(rangeScore(features.avgInterval || 0, 0.35, 0.75, 0.25), 1.1);
            weigh(rangeScore(features.meanPeak, 0.07, 0.16, 0.06), 1.0);
            weigh(rangeScore(features.highRatioMean, 0.12, 0.35, 0.15), 1.2);
            weigh(rangeScore(features.centroidMean, 350, 650, 160), 0.9);
            return total ? score / total : 0;
        }
    },
    {
        id: "assembly",
        label: "Assembly call",
        translation: "Group up with me at this spot.",
        behavior: "Series of four to five caws summons family members prior to travel or sharing food discoveries.",
        acoustic: [
            "4-6 moderate calls",
            "Spacing <= 0.55 s",
            "Dominant frequency 350-750 Hz",
            "Balanced harmonic profile"
        ],
        match(features) {
            if (features.count < 4) return 0;
            let total = 0;
            let score = 0;
            const weigh = (value, weight = 1) => { total += weight; score += value * weight; };
            weigh(rangeScore(features.count, 4, 6, 2), 1.1);
            weigh(rangeScore(features.avgInterval || 0, 0.18, 0.55, 0.18), 1.1);
            weigh(rangeScore(features.meanPeak, 0.05, 0.14, 0.05), 1.0);
            weigh(rangeScore(features.centroidMean, 360, 760, 180), 1.0);
            weigh(rangeScore(features.highRatioMean, 0.16, 0.4, 0.16), 0.9);
            return total ? score / total : 0;
        }
    },
    {
        id: "foodDiscovery",
        label: "Food discovery call",
        translation: "Fresh food here, come share!",
        behavior: "Excited mid-range caws summon relatives to new food sources; often given near carcasses or crops (Marzluff & Heinrich 1991).",
        acoustic: [
            "3-7 upbeat caws",
            "Spacing 0.18-0.48 s",
            "Centroid 420-640 Hz",
            "Upper harmonics pronounced"
        ],
        match(features) {
            if (features.count < 3) return 0;
            let total = 0;
            let score = 0;
            const weigh = (value, weight = 1) => { total += weight; score += value * weight; };
            weigh(rangeScore(features.count, 3, 7, 3), 1.0);
            weigh(rangeScore(features.avgInterval || 0, 0.18, 0.48, 0.14), 1.1);
            weigh(rangeScore(features.centroidMean, 420, 640, 140), 1.1);
            weigh(rangeScore(features.highRatioMean, 0.32, 0.6, 0.2), 1.0);
            weigh(rangeScore(features.meanPeak, 0.05, 0.15, 0.05), 0.9);
            return total ? score / total : 0;
        }
    },
    {
        id: "contact",
        label: "Contact call",
        translation: "Where are you? Keep checking in!",
        behavior: "Short single or double caws help family members maintain spacing while foraging (Cornell Lab Birds of the World).",
        acoustic: [
            "1-3 calls",
            "Spacing >= 0.28 s",
            "Dominant frequency 320-680 Hz",
            "Limited upper harmonics"
        ],
        match(features) {
            if (features.count < 1 || features.count > 3) return 0;
            let total = 0;
            let score = 0;
            const weigh = (value, weight = 1) => { total += weight; score += value * weight; };
            weigh(rangeScore(features.meanPeak, 0.035, 0.13, 0.05), 1.0);
            weigh(rangeScore(features.avgInterval || 0.32, 0.28, 1.1, 0.4), 1.1);
            weigh(rangeScore(features.centroidMean, 320, 680, 150), 1.0);
            weigh(rangeScore(features.highRatioMean, 0.08, 0.32, 0.12), 1.2);
            return total ? score / total : 0;
        }
    },    {
        id: "juvenileBegging",
        label: "Juvenile begging",
        translation: "I need food over here!",
        behavior: "Young American crows give nasal, higher-pitched repeated cries while soliciting feedings during late spring and summer.",
        acoustic: [
            "5+ short calls",
            "Each < 0.22 s",
            "Centroid >= 500 Hz",
            "High harmonic energy"
        ],
        match(features) {
            if (features.count < 5) return 0;
            let total = 0;
            let score = 0;
            const weigh = (value, weight = 1) => { total += weight; score += value * weight; };
            weigh(rangeScore(features.avgDuration, 0.08, 0.22, 0.08), 1.1);
            weigh(rangeScore(features.highRatioMean, 0.35, 0.7, 0.2), 1.1);
            weigh(rangeScore(features.centroidMean, 520, 900, 200), 1.1);
            weigh(rangeScore(features.meanPeak, 0.03, 0.1, 0.05), 0.8);
            return total ? score / total : 0;
        }
    },
    {
        id: "flightCoordination",
        label: "Flight coordination",
        translation: "Change course with me now!",
        behavior: "Coordinated bursts mid-flight keep flock members aligned when shifting direction or altitude.",
        acoustic: [
            "3-6 quick caws",
            "Spacing 0.15-0.35 s",
            "Dominant frequency 450-900 Hz",
            "Moderate high-harmonic content"
        ],
        match(features) {
            if (features.count < 3) return 0;
            let total = 0;
            let score = 0;
            const weigh = (value, weight = 1) => { total += weight; score += value * weight; };
            weigh(rangeScore(features.avgInterval || 0, 0.15, 0.35, 0.1), 1.2);
            weigh(rangeScore(features.centroidMean, 460, 900, 160), 1.0);
            weigh(rangeScore(features.highRatioMean, 0.28, 0.52, 0.16), 0.9);
            weigh(rangeScore(features.meanPeak, 0.05, 0.16, 0.06), 0.9);
            weigh(rangeScore(features.count, 3, 6, 2), 1.0);
            return total ? score / total : 0;
        }
    },
    {
        id: "roostAssembly",
        label: "Roost assembly",
        translation: "Dusk meet-up forming now!",
        behavior: "High-count bouts near evening roosts rally scattered birds before settling (Marzluff & Angell 2005).",
        acoustic: [
            "8+ calls in wave",
            "Spacing 0.25-0.6 s",
            "Moderate intensity",
            "Dominant frequency 380-700 Hz"
        ],
        match(features) {
            if (features.count < 8) return 0;
            let total = 0;
            let score = 0;
            const weigh = (value, weight = 1) => { total += weight; score += value * weight; };
            weigh(rangeScore(features.count, 8, 20, 6), 1.2);
            weigh(rangeScore(features.avgInterval || 0, 0.25, 0.6, 0.18), 1.0);
            weigh(rangeScore(features.meanPeak, 0.05, 0.16, 0.05), 0.9);
            weigh(rangeScore(features.centroidMean, 380, 700, 150), 1.0);
            weigh(rangeScore(features.highRatioMean, 0.15, 0.45, 0.18), 0.9);
            return total ? score / total : 0;
        }
    }
];

const PLAYBACK_LIBRARY = [
    {
        id: "contact",
        label: "Contact call",
        description: "Gentle check-in caws keep family members oriented while foraging.",
        profileId: "contact",
        defaultSpacing: 0.35,
        sequence: [
            { duration: 0.32, baseFreq: 520, freqSlide: -140, amplitude: 0.65, noise: 0.25 },
            { rest: 0.24 },
            { duration: 0.28, baseFreq: 500, freqSlide: -120, amplitude: 0.6, noise: 0.22 }
        ]
    },
    {
        id: "assembly",
        label: "Assembly call",
        description: "Upbeat gather-up series used before travel or new feeding bouts.",
        profileId: "assembly",
        defaultSpacing: 0.45,
        sequence: [
            { duration: 0.28, baseFreq: 560, freqSlide: -90, amplitude: 0.7, noise: 0.28 },
            { rest: 0.22 },
            { duration: 0.27, baseFreq: 540, freqSlide: -110, amplitude: 0.7, noise: 0.25 },
            { rest: 0.22 },
            { duration: 0.29, baseFreq: 520, freqSlide: -130, amplitude: 0.68, noise: 0.27 },
            { rest: 0.22 },
            { duration: 0.28, baseFreq: 500, freqSlide: -110, amplitude: 0.65, noise: 0.24 }
        ]
    },
    {
        id: "foodDiscovery",
        label: "Food discovery",
        description: "Bright recruitment bursts inviting relatives to a new food source.",
        profileId: "foodDiscovery",
        defaultSpacing: 0.38,
        sequence: [
            { duration: 0.26, baseFreq: 620, freqSlide: -160, amplitude: 0.7, noise: 0.35 },
            { rest: 0.18 },
            { duration: 0.27, baseFreq: 600, freqSlide: -150, amplitude: 0.72, noise: 0.32 },
            { rest: 0.2 },
            { duration: 0.25, baseFreq: 580, freqSlide: -140, amplitude: 0.7, noise: 0.3 }
        ]
    },
    {
        id: "alarmRally",
        label: "Alarm rally",
        description: "Harsh recruitment calls for mobbing a predator.",
        profileId: "alarmRally",
        defaultSpacing: 0.26,
        sequence: [
            { duration: 0.24, baseFreq: 740, freqSlide: -220, amplitude: 0.88, noise: 0.5 },
            { rest: 0.18 },
            { duration: 0.25, baseFreq: 720, freqSlide: -210, amplitude: 0.9, noise: 0.5 },
            { rest: 0.18 },
            { duration: 0.22, baseFreq: 700, freqSlide: -200, amplitude: 0.9, noise: 0.52 }
        ]
    },
    {
        id: "groundThreat",
        label: "Ground predator scold",
        description: "Firm perched calls used on terrestrial intruders.",
        profileId: "groundThreat",
        defaultSpacing: 0.5,
        sequence: [
            { duration: 0.32, baseFreq: 560, freqSlide: -160, amplitude: 0.75, noise: 0.28 },
            { rest: 0.34 },
            { duration: 0.31, baseFreq: 540, freqSlide: -150, amplitude: 0.73, noise: 0.26 },
            { rest: 0.34 },
            { duration: 0.3, baseFreq: 520, freqSlide: -150, amplitude: 0.72, noise: 0.25 }
        ]
    },
    {
        id: "territorialScold",
        label: "Territorial scold",
        description: "Extended boundary defense bursts for nest protection.",
        profileId: "territorialScold",
        defaultSpacing: 0.55,
        sequence: [
            { duration: 0.28, baseFreq: 520, freqSlide: -120, amplitude: 0.68, noise: 0.22 },
            { rest: 0.28 },
            { duration: 0.28, baseFreq: 500, freqSlide: -110, amplitude: 0.68, noise: 0.22 },
            { rest: 0.28 },
            { duration: 0.28, baseFreq: 480, freqSlide: -110, amplitude: 0.68, noise: 0.22 },
            { rest: 0.28 },
            { duration: 0.28, baseFreq: 460, freqSlide: -110, amplitude: 0.68, noise: 0.22 }
        ]
    },
    {
        id: "hawkSentinel",
        label: "Hawk sentinel alarm",
        description: "Elongated look-out warnings for soaring raptors.",
        profileId: "hawkSentinel",
        defaultSpacing: 0.6,
        sequence: [
            { duration: 0.42, baseFreq: 800, freqSlide: -260, amplitude: 0.85, noise: 0.4 },
            { rest: 0.32 },
            { duration: 0.4, baseFreq: 780, freqSlide: -240, amplitude: 0.84, noise: 0.38 },
            { rest: 0.32 },
            { duration: 0.38, baseFreq: 760, freqSlide: -220, amplitude: 0.82, noise: 0.36 }
        ]
    },
    {
        id: "juvenileBegging",
        label: "Juvenile begging",
        description: "Thin insistent cries used by fledglings requesting food.",
        profileId: "juvenileBegging",
        defaultSpacing: 0.28,
        sequence: [
            { duration: 0.2, baseFreq: 920, freqSlide: -260, amplitude: 0.6, noise: 0.45 },
            { rest: 0.16 },
            { duration: 0.2, baseFreq: 900, freqSlide: -240, amplitude: 0.6, noise: 0.45 },
            { rest: 0.16 },
            { duration: 0.2, baseFreq: 880, freqSlide: -220, amplitude: 0.58, noise: 0.45 },
            { rest: 0.16 },
            { duration: 0.2, baseFreq: 860, freqSlide: -200, amplitude: 0.58, noise: 0.45 }
        ]
    },
    {
        id: "flightCoordination",
        label: "Flight coordination",
        description: "Snappy in-flight pulses to realign flock members.",
        profileId: "flightCoordination",
        defaultSpacing: 0.33,
        sequence: [
            { duration: 0.22, baseFreq: 700, freqSlide: -180, amplitude: 0.7, noise: 0.3 },
            { rest: 0.18 },
            { duration: 0.22, baseFreq: 680, freqSlide: -170, amplitude: 0.7, noise: 0.3 },
            { rest: 0.18 },
            { duration: 0.22, baseFreq: 660, freqSlide: -160, amplitude: 0.7, noise: 0.3 }
        ]
    },
    {
        id: "roostAssembly",
        label: "Roost assembly",
        description: "Evening rally strings preceding communal roosting.",
        profileId: "roostAssembly",
        defaultSpacing: 0.48,
        sequence: [
            { duration: 0.26, baseFreq: 520, freqSlide: -120, amplitude: 0.65, noise: 0.24 },
            { rest: 0.24 },
            { duration: 0.26, baseFreq: 500, freqSlide: -120, amplitude: 0.65, noise: 0.24 },
            { rest: 0.24 },
            { duration: 0.26, baseFreq: 480, freqSlide: -120, amplitude: 0.65, noise: 0.24 },
            { rest: 0.24 },
            { duration: 0.26, baseFreq: 460, freqSlide: -120, amplitude: 0.65, noise: 0.24 },
            { rest: 0.24 },
            { duration: 0.26, baseFreq: 440, freqSlide: -120, amplitude: 0.65, noise: 0.24 }
        ]
    }
];

const playbackState = {
    context: null,
    gain: null,
    sources: [],
    noiseBuffer: null,
    active: false,
    stopAt: 0,
    status: "idle"
};

let playbackOnlyContext = null;


let voiceList = [];

setup();


function setup() {
    renderKnowledgeBase();
    renderPlaybackOptions();
    applySettingsToUI();
    bindEvents();
    updateConfigFromSettings();
    updateConfidenceDisplay();
    updateSensitivityDisplay();
    updateCooldownDisplay();
    updateCategoryTable();
    updatePlaybackLabels();
    updatePlaybackDescription();
    updatePlaybackStatus("Idle", "idle");
    loadVoices();
    if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.addEventListener("voiceschanged", loadVoices);
    }
    window.setInterval(updatePassiveAnalytics, 1000);
}


function bindEvents() {
    ui.button.addEventListener("click", () => {
        state.listening ? stopListening() : startListening();
    });

    ui.calibrate.addEventListener("click", () => {
        if (!state.listening) {
            showStatus("Start the microphone before calibrating.");
            return;
        }
        beginCalibration();
    });

    document.body.addEventListener("touchend", () => {
        if (audioContext && audioContext.state === "suspended") {
            audioContext.resume();
        }
        if (playbackOnlyContext && playbackOnlyContext.state === "suspended") {
            playbackOnlyContext.resume();
        }
    }, { passive: true });

    ui.autoSpeak.addEventListener("change", () => {
        settings.autoSpeak = ui.autoSpeak.checked;
        saveSettings();
    });

    ui.verboseTts.addEventListener("change", () => {
        settings.verboseTts = ui.verboseTts.checked;
        saveSettings();
    });

    ui.autoScroll.addEventListener("change", () => {
        settings.autoScroll = ui.autoScroll.checked;
        saveSettings();
    });

    ui.voiceSelect.addEventListener("change", () => {
        settings.voiceURI = ui.voiceSelect.value || null;
        saveSettings();
    });

    ui.confidenceSlider.addEventListener("input", () => {
        settings.confidence = Number(ui.confidenceSlider.value);
        updateConfigFromSettings();
        updateConfidenceDisplay();
        saveSettings();
    });

    ui.sensitivitySlider.addEventListener("input", () => {
        settings.sensitivity = Number(ui.sensitivitySlider.value);
        updateConfigFromSettings();
        updateSensitivityDisplay();
        saveSettings();
    });

    ui.cooldownSlider.addEventListener("input", () => {
        settings.cooldown = Number(ui.cooldownSlider.value);
        updateConfigFromSettings();
        updateCooldownDisplay();
        saveSettings();
    });

    ui.playbackPreset.addEventListener("change", () => {
        updatePlaybackDescription();
        updatePlaybackStatus("Idle", "idle");
    });

    ui.playbackRepeats.addEventListener("input", updatePlaybackLabels);
    ui.playbackSpacing.addEventListener("input", updatePlaybackLabels);
    ui.playbackGain.addEventListener("input", updatePlaybackLabels);

    ui.playbackPlay.addEventListener("click", () => {
        playSelectedCall().catch(error => {
            console.error(error);
            updatePlaybackStatus("Playback error", "error");
        });
    });

    ui.playbackStop.addEventListener("click", () => {
        stopPlayback(true);
    });

    ui.downloadLog.addEventListener("click", downloadLog);
    ui.clearLog.addEventListener("click", clearLog);

    ui.knowledgeCards.addEventListener("click", event => {
        const button = event.target.closest("[data-broadcast]");
        if (!button) return;
        const id = button.getAttribute("data-broadcast");
        if (ui.playbackPreset.value !== id) {
            ui.playbackPreset.value = id;
            updatePlaybackDescription();
        }
        playSelectedCall().catch(error => {
            console.error(error);
            updatePlaybackStatus("Playback error", "error");
        });
    });

    window.addEventListener("beforeunload", () => {
        if (state.listening) {
            stopListening();
        }
        stopPlayback(false);
    });
}

async function startListening() {
    if (state.listening) return;
    try {
        ui.button.disabled = true;
        showStatus("Requesting microphone...");
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 48000,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            },
            video: false
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = config.fftSize;
        analyser.minDecibels = -100;
        analyser.maxDecibels = -10;
        analyser.smoothingTimeConstant = 0.3;

        processor = audioContext.createScriptProcessor(config.sampleBufferSize, 1, 1);
        processor.onaudioprocess = handleAudio;

        const source = audioContext.createMediaStreamSource(mediaStream);
        source.connect(analyser);
        analyser.connect(processor);

        zeroGain = audioContext.createGain();
        zeroGain.gain.value = 0;
        processor.connect(zeroGain);
        zeroGain.connect(audioContext.destination);

        resetCallState();
        state.listening = true;
        state.sessionStart = Date.now();
        ui.button.textContent = "Stop Analyzing";
        ui.button.disabled = false;
        showStatus("Listening for vocalizations...");
    } catch (error) {
        console.error(error);
        showStatus(`Microphone error: ${error.message}`);
        ui.button.disabled = false;
    }
}

function stopListening() {
    if (!state.listening) return;
    processor?.disconnect();
    analyser?.disconnect();
    zeroGain?.disconnect();
    mediaStream?.getTracks().forEach(track => track.stop());
    audioContext?.close();

    resetCallState();
    state.listening = false;
    state.calibrating = false;
    ui.calibrationIndicator.hidden = true;
    ui.button.textContent = "Start Analyzing";
    showStatus("Microphone idle");
    ui.levelMeter.style.setProperty("--level", "0");
}

function resetCallState() {
    state.callActive = false;
    state.callSilentFrames = 0;
    state.callFrames = 0;
    state.callRmsSum = 0;
    state.callMaxRms = 0;
    state.callDominantFreqSum = 0;
    state.callCentroidSum = 0;
    state.callHighRatioSum = 0;
    state.callMidRatioSum = 0;
    state.callLowRatioSum = 0;
    state.specSamples = 0;
    state.callHistory = [];
    state.lastAnnouncementTime = 0;
}
function handleAudio(event) {
    analyser.getFloatTimeDomainData(timeData);
    analyser.getByteFrequencyData(freqData);

    const inputBuffer = event.inputBuffer.getChannelData(0);
    const rms = computeRms(timeData);
    state.lastRms = rms;
    const now = audioContext.currentTime;

    const suppressed = now < state.suppressDetectionUntil;

    updateLevelMeter(rms);

    if (suppressed) {
        state.callActive = false;
        state.callHistory = [];
        return;
    }

    updateNoiseModel(rms);
    const spectrum = analyzeSpectrum(freqData, audioContext.sampleRate);

    const thresholds = {
        start: state.noiseFloor + config.startNoiseDelta,
        stop: state.noiseFloor + config.stopNoiseDelta
    };

    if (!state.callActive && rms > thresholds.start) {
        beginCall(now);
    }

    if (state.callActive) {
        accumulateCallFrame(rms, spectrum);
        const frameDuration = inputBuffer.length / audioContext.sampleRate;

        if (rms < thresholds.stop) {
            state.callSilentFrames += 1;
        } else {
            state.callSilentFrames = 0;
        }

        const silenceTime = state.callSilentFrames * frameDuration;
        const callDuration = state.callFrames * frameDuration;

        const durationExceeded = callDuration > config.maxCallDuration;
        const shouldRelease = silenceTime > config.silenceRelease && callDuration >= config.minCallDuration;

        if (shouldRelease || durationExceeded) {
            finishCall(now, callDuration);
        }
    }

    if (now - state.lastAnalyticsUpdate > 0.25) {
        updateAmbientDisplays();
        state.lastAnalyticsUpdate = now;
    }
}

function beginCall(timeStamp) {
    state.callActive = true;
    state.callFrames = 0;
    state.callSilentFrames = 0;
    state.callRmsSum = 0;
    state.callMaxRms = 0;
    state.callDominantFreqSum = 0;
    state.callCentroidSum = 0;
    state.callHighRatioSum = 0;
    state.callMidRatioSum = 0;
    state.callLowRatioSum = 0;
    state.specSamples = 0;
    state.callStartTime = timeStamp;
}

function accumulateCallFrame(rms, spectrum) {
    state.callFrames += 1;
    state.callRmsSum += rms;
    state.callMaxRms = Math.max(state.callMaxRms, rms);

    if (spectrum.energy > 0) {
        state.callDominantFreqSum += spectrum.dominant;
        state.callCentroidSum += spectrum.centroid;
        state.callHighRatioSum += spectrum.highRatio;
        state.callMidRatioSum += spectrum.midRatio;
        state.callLowRatioSum += spectrum.lowRatio;
        state.specSamples += 1;
    }
}

function finishCall(timeStamp, duration) {
    const meanRms = state.callFrames ? state.callRmsSum / state.callFrames : 0;
    const call = {
        timestamp: timeStamp,
        startTime: state.callStartTime,
        endTime: timeStamp,
        duration,
        peakRms: state.callMaxRms,
        meanRms,
        dominantFreq: state.specSamples ? state.callDominantFreqSum / state.specSamples : 0,
        spectralCentroid: state.specSamples ? state.callCentroidSum / state.specSamples : 0,
        highFreqRatio: state.specSamples ? state.callHighRatioSum / state.specSamples : 0,
        midFreqRatio: state.specSamples ? state.callMidRatioSum / state.specSamples : 0,
        lowFreqRatio: state.specSamples ? state.callLowRatioSum / state.specSamples : 0
    };

    state.callActive = false;
    state.callHistory.push(call);
    const cutoff = timeStamp - config.burstWindowSeconds;
    state.callHistory = state.callHistory.filter(item => item.timestamp >= cutoff);

    evaluateBurst(timeStamp);
}

function evaluateBurst(now) {
    const burst = groupRecentCalls(now);
    if (!burst) return;

    const features = computeBurstFeatures(burst);
    state.intervalHistory.push(...features.intervals);
    if (state.intervalHistory.length > 200) {
        state.intervalHistory.splice(0, state.intervalHistory.length - 200);
    }

    const matches = evaluateProfiles(features);
    if (!matches.length) return;
    const best = matches[0];

    if (best.confidence < config.minConfidence) return;
    if (audioContext && audioContext.currentTime - state.lastAnnouncementTime < config.announcementCooldown) return;

    state.lastAnnouncementTime = audioContext ? audioContext.currentTime : 0;
    const profile = best.profile;

    const entry = {
        time: new Date(),
        profileId: profile.id,
        label: profile.label,
        translation: profile.translation,
        behavior: profile.behavior,
        confidence: best.confidence,
        features,
        calls: burst
    };
    state.sessionLog.unshift(entry);
    if (state.sessionLog.length > 250) {
        state.sessionLog.pop();
    }

    state.acceptedBurstTimes.push(Date.now());
    if (state.acceptedBurstTimes.length > 500) {
        state.acceptedBurstTimes.splice(0, state.acceptedBurstTimes.length - 500);
    }

    const statEntry = state.categoryStats.get(profile.id) || { label: profile.label, count: 0, lastSeen: null };
    statEntry.count += 1;
    statEntry.lastSeen = entry.time;
    state.categoryStats.set(profile.id, statEntry);

    renderLogEntry(entry);
    updateCategoryTable();
    ui.totalBursts.textContent = String(state.sessionLog.length);
    ui.lastInterpretation.textContent = `${profile.label} (${Math.round(best.confidence * 100)}%)`;

    announceInterpretation(entry);
}

function renderLogEntry(entry) {
    const article = document.createElement("article");
    article.className = "entry";

    const timestamp = entry.time.toLocaleTimeString();
    const metrics = `calls: ${entry.features.count} | mean duration: ${(entry.features.avgDuration * 1000).toFixed(0)} ms | spacing: ${entry.features.avgInterval ? (entry.features.avgInterval * 1000).toFixed(0) : "--"} ms | dominant: ${Math.round(entry.features.dominantMean)} Hz`;

    const confidence = `confidence: ${(entry.confidence * 100).toFixed(0)}%`;

    article.innerHTML = `
        <header>
            <time>${timestamp}</time>
            <span class="confidence">${confidence}</span>
        </header>
        <div class="label">${entry.label}</div>
        <div class="translation">${entry.translation}</div>
        <div class="details">${entry.behavior}</div>
        <div class="metrics">${metrics}</div>
    `;

    ui.translationLog.prepend(article);
    while (ui.translationLog.children.length > 100) {
        ui.translationLog.removeChild(ui.translationLog.lastChild);
    }

    if (settings.autoScroll) {
        ui.translationLog.scrollTo({ top: 0, behavior: "smooth" });
    }
}

function announceInterpretation(entry) {
    if (!("speechSynthesis" in window) || !settings.autoSpeak) return;
    const utterance = new SpeechSynthesisUtterance();
    utterance.lang = "en-US";
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    if (settings.voiceURI) {
        const voice = voiceList.find(v => v.voiceURI === settings.voiceURI);
        if (voice) {
            utterance.voice = voice;
        }
    }
    const summary = settings.verboseTts ? `${entry.label}. ${entry.translation}. ${entry.behavior}` : `${entry.label}. ${entry.translation}`;
    utterance.text = summary;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
}

function groupRecentCalls(now) {
    const relevant = state.callHistory.filter(call => now - call.timestamp <= config.burstWindowSeconds);
    if (!relevant.length) return null;
    relevant.sort((a, b) => a.startTime - b.startTime);

    const burst = [relevant[0]];
    for (let i = 1; i < relevant.length; i += 1) {
        const previous = burst[burst.length - 1];
        const current = relevant[i];
        if (current.startTime - previous.timestamp <= config.burstGapSeconds) {
            burst.push(current);
        } else {
            burst.length = 0;
            burst.push(current);
        }
    }

    return burst.length ? burst : null;
}

function computeBurstFeatures(burst) {
    const count = burst.length;
    const durations = burst.map(c => c.duration);
    const peaks = burst.map(c => c.peakRms);
    const centroids = burst.map(c => c.spectralCentroid);
    const highRatios = burst.map(c => c.highFreqRatio);
    const dominant = burst.map(c => c.dominantFreq);

    const intervals = [];
    for (let i = 1; i < burst.length; i += 1) {
        intervals.push(burst[i].startTime - burst[i - 1].startTime);
    }

    const burstStart = burst[0].startTime;
    const burstEnd = burst[burst.length - 1].timestamp;
    const burstSpan = burstEnd - burstStart;

    return {
        count,
        durations,
        peaks,
        centroids,
        highRatios,
        dominant,
        intervals,
        burstSpan,
        avgDuration: avg(durations),
        meanPeak: avg(peaks),
        maxPeak: Math.max(...peaks),
        minPeak: Math.min(...peaks),
        centroidMean: avg(centroids),
        highRatioMean: avg(highRatios),
        dominantMean: avg(dominant),
        avgInterval: intervals.length ? avg(intervals) : null,
        minInterval: intervals.length ? Math.min(...intervals) : null,
        maxInterval: intervals.length ? Math.max(...intervals) : null,
        medianInterval: intervals.length ? median(intervals) : null
    };
}

function evaluateProfiles(features) {
    return CALL_PROFILES.map(profile => {
        const confidence = profile.match(features);
        return { profile, confidence };
    }).filter(item => item.confidence >= 0.2).sort((a, b) => b.confidence - a.confidence);
}function updateNoiseModel(rms) {
    const clamped = Math.min(Math.max(rms, 0.001), 0.12);
    if (state.calibrating) {
        state.calibrationSum += clamped;
        state.calibrationSamples += 1;
        const remaining = state.calibrationEnd - (audioContext ? audioContext.currentTime : 0);
        if (remaining <= 0) {
            finishCalibration();
        } else {
            ui.calibrationTimer.textContent = remaining.toFixed(1);
        }
        return;
    }
    if (!state.callActive) {
        state.noiseFloor = (state.noiseFloor * 0.97) + (clamped * 0.03);
    }
}

function beginCalibration() {
    if (!audioContext) return;
    state.calibrating = true;
    state.calibrationSum = 0;
    state.calibrationSamples = 0;
    state.calibrationEnd = audioContext.currentTime + config.calibrationSeconds;
    ui.calibrationIndicator.hidden = false;
    ui.calibrationTimer.textContent = config.calibrationSeconds.toFixed(1);
    showStatus("Calibrating ambient noise...");
}

function finishCalibration() {
    state.calibrating = false;
    ui.calibrationIndicator.hidden = true;
    if (state.calibrationSamples > 0) {
        const average = state.calibrationSum / state.calibrationSamples;
        state.noiseFloor = average * 1.1;
        showStatus("Calibration complete.");
    } else {
        showStatus("Calibration failed to collect samples.");
    }
}

function updateLevelMeter(rms) {
    const db = dbForRms(rms);
    const normalized = clamp((db + 70) / 60, 0, 1);
    state.levelSmoother = state.levelSmoother * 0.8 + normalized * 0.2;
    ui.levelMeter.style.setProperty("--level", state.levelSmoother.toFixed(3));
}

function updateAmbientDisplays() {
    ui.ambientLevel.textContent = formatDb(dbForRms(state.noiseFloor));
    ui.ambientRms.textContent = formatDb(dbForRms(state.lastRms));
    const medianSpacingValue = median(state.intervalHistory);
    ui.medianSpacing.textContent = medianSpacingValue ? `${(medianSpacingValue * 1000).toFixed(0)} ms` : "--";
}


function updatePassiveAnalytics() {
    const now = Date.now();
    state.acceptedBurstTimes = state.acceptedBurstTimes.filter(ts => now - ts <= 60000);
    ui.burstRate.textContent = state.acceptedBurstTimes.length.toString();

    if (state.sessionStart) {
        const elapsed = now - state.sessionStart;
        ui.sessionDuration.textContent = formatDuration(elapsed);
    } else {
        ui.sessionDuration.textContent = "0:00";
    }

    if (playbackState.active && playbackState.context) {
        const ctxState = playbackState.context.state;
        if (ctxState === "closed" || playbackState.context.currentTime >= playbackState.stopAt) {
            stopPlayback(false);
        }
    }
}


function renderKnowledgeBase() {
    ui.knowledgeCards.innerHTML = "";
    const playbackIds = new Set(PLAYBACK_LIBRARY.map(item => item.id));
    CALL_PROFILES.forEach(profile => {
        const card = document.createElement("article");
        card.className = "call-card";
        const listItems = profile.acoustic.map(item => `<li>${item}</li>`).join("");
        const playbackButton = playbackIds.has(profile.id)
            ? `<div class="card-actions"><button class="btn ghost small" data-broadcast="${profile.id}">Broadcast preset</button></div>`
            : "";
        card.innerHTML = `
            <h3>${profile.label}</h3>
            <p class="context">${profile.behavior}</p>
            <p class="context"><strong>Field translation:</strong> ${profile.translation}</p>
            <ul>${listItems}</ul>
            ${playbackButton}
        `;
        ui.knowledgeCards.append(card);
    });
}

function updateCategoryTable() {
    const tbody = ui.categoryTable.querySelector("tbody");
    tbody.innerHTML = "";
    const rows = Array.from(state.categoryStats.values()).sort((a, b) => b.count - a.count);
    rows.forEach(row => {
        const tr = document.createElement("tr");
        const lastSeenLabel = row.lastSeen ? row.lastSeen.toLocaleTimeString() : "--";
        tr.innerHTML = `
            <td>${row.label}</td>
            <td>${row.count}</td>
            <td>${lastSeenLabel}</td>
        `;
        tbody.append(tr);
    });
    if (!rows.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="3">No detections yet.</td>`;
        tbody.append(tr);
    }
}

function downloadLog() {
    if (!state.sessionLog.length) {
        showStatus("Nothing to download yet.");
        return;
    }
    const header = ["timestamp", "category", "confidence", "translation", "mean_duration_ms", "avg_interval_ms", "dominant_hz", "peak_rms"];
    const rows = state.sessionLog.map(entry => [
        entry.time.toISOString(),
        entry.label,
        Math.round(entry.confidence * 100),
        entry.translation.replace(/\n/g, " "),
        (entry.features.avgDuration * 1000).toFixed(1),
        entry.features.avgInterval ? (entry.features.avgInterval * 1000).toFixed(1) : "",
        Math.round(entry.features.dominantMean),
        entry.features.meanPeak.toFixed(3)
    ]);
    const csv = [header, ...rows].map(cols => cols.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `crow-call-log-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function clearLog() {
    state.sessionLog = [];
    state.categoryStats.clear();
    state.acceptedBurstTimes = [];
    ui.translationLog.innerHTML = "";
    ui.totalBursts.textContent = "0";
    ui.lastInterpretation.textContent = "--";
    updateCategoryTable();
}

function loadVoices() {
    if (!("speechSynthesis" in window)) {
        ui.voiceSelect.disabled = true;
        ui.voiceSelect.innerHTML = `<option value="">Speech synthesis unavailable</option>`;
        return;
    }
    voiceList = speechSynthesis.getVoices().filter(voice => voice.lang.startsWith("en"));
    ui.voiceSelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "System default";
    ui.voiceSelect.append(defaultOption);
    voiceList.forEach(voice => {
        const option = document.createElement("option");
        option.value = voice.voiceURI;
        option.textContent = `${voice.name} (${voice.lang})`;
        ui.voiceSelect.append(option);
    });
    if (settings.voiceURI) {
        ui.voiceSelect.value = settings.voiceURI;
    }
}

function applySettingsToUI() {
    ui.autoSpeak.checked = settings.autoSpeak;
    ui.verboseTts.checked = settings.verboseTts;
    ui.autoScroll.checked = settings.autoScroll;
    ui.confidenceSlider.value = settings.confidence;
    ui.sensitivitySlider.value = settings.sensitivity;
    ui.cooldownSlider.value = settings.cooldown;
}

function updateConfigFromSettings() {
    const sensitivity = settings.sensitivity / 100;
    const sensitivityScale = lerp(1.7, 0.55, sensitivity);
    config.startNoiseDelta = config.baseStartDelta * sensitivityScale;
    config.stopNoiseDelta = config.baseStopDelta * sensitivityScale;

    config.minConfidence = settings.confidence / 100;
    config.announcementCooldown = settings.cooldown;
}

function updateConfidenceDisplay() {
    ui.confidenceLabel.textContent = `${settings.confidence}%`;
    ui.confidenceDisplay.textContent = `${settings.confidence}%`;
}

function updateSensitivityDisplay() {
    const value = settings.sensitivity;
    let descriptor = "Neutral";
    if (value < 35) descriptor = "Low";
    else if (value > 65) descriptor = "High";
    ui.sensitivityLabel.textContent = descriptor;
}

function updateCooldownDisplay() {
    ui.cooldownLabel.textContent = `${settings.cooldown} s`;
}

function showStatus(message) {
    ui.status.textContent = message;
}

function computeRms(samples) {
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i += 1) {
        const sample = samples[i];
        sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / samples.length);
}

function analyzeSpectrum(magnitudes, sampleRate) {
    const nyquist = sampleRate / 2;
    const binWidth = nyquist / magnitudes.length;
    let totalEnergy = 0;
    let dominantFreq = 0;
    let maxMag = -Infinity;
    let centroidNumerator = 0;
    let lowEnergy = 0;
    let midEnergy = 0;
    let highEnergy = 0;

    for (let i = 1; i < magnitudes.length; i += 1) {
        const magnitude = magnitudes[i] / 255;
        if (magnitude <= 0.0001) continue;
        const frequency = i * binWidth;
        if (frequency < 80 || frequency > 3000) continue;
        const contribution = magnitude;
        totalEnergy += contribution;
        centroidNumerator += contribution * frequency;
        if (frequency < 350) lowEnergy += contribution;
        else if (frequency < 1200) midEnergy += contribution;
        else highEnergy += contribution;
        if (magnitude > maxMag) {
            maxMag = magnitude;
            dominantFreq = frequency;
        }
    }

    const centroid = totalEnergy > 0 ? centroidNumerator / totalEnergy : 0;
    const highRatio = totalEnergy > 0 ? highEnergy / totalEnergy : 0;
    const midRatio = totalEnergy > 0 ? midEnergy / totalEnergy : 0;
    const lowRatio = totalEnergy > 0 ? lowEnergy / totalEnergy : 0;

    return {
        dominant: dominantFreq,
        centroid,
        highRatio,
        midRatio,
        lowRatio,
        energy: totalEnergy
    };
}

function formatDb(db) {
    if (!isFinite(db)) return "--";
    return `${db.toFixed(0)} dBFS`;
}

function dbForRms(rms) {
    if (!rms || rms <= 1e-6) return -90;
    return 20 * Math.log10(rms);
}

function avg(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
    if (!values || !values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function lerp(min, max, t) {
    return min + (max - min) * t;
}

function rangeScore(value, min, max, slack = (max - min) * 0.5) {
    if (!isFinite(value)) return 0;
    if (value >= min && value <= max) return 1;
    if (slack <= 0) return 0;
    const distance = value < min ? min - value : value - max;
    const adjusted = 1 - (distance / slack);
    return adjusted < 0 ? 0 : adjusted;
}

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(localStorageKey);
        if (!raw) return { ...defaultSettings };
        const parsed = JSON.parse(raw);
        return { ...defaultSettings, ...parsed };
    } catch (error) {
        console.warn("Failed to load settings", error);
        return { ...defaultSettings };
    }
}

function saveSettings() {
    try {
        localStorage.setItem(localStorageKey, JSON.stringify(settings));
    } catch (error) {
        console.warn("Unable to save settings", error);
    }
}

function renderPlaybackOptions() {
    if (!ui.playbackPreset) return;
    ui.playbackPreset.innerHTML = "";
    PLAYBACK_LIBRARY.forEach(item => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.label;
        ui.playbackPreset.append(option);
    });
    if (PLAYBACK_LIBRARY.length) {
        ui.playbackPreset.value = PLAYBACK_LIBRARY[0].id;
    }
}

function updatePlaybackLabels() {
    if (!ui.playbackRepeatsLabel) return;
    ui.playbackRepeatsLabel.textContent = `${ui.playbackRepeats.value}x`;
    ui.playbackSpacingLabel.textContent = `${ui.playbackSpacing.value} ms`;
    ui.playbackGainLabel.textContent = `${ui.playbackGain.value}%`;
}

function updatePlaybackDescription() {
    if (!ui.playbackDescription) return;
    const preset = PLAYBACK_LIBRARY.find(item => item.id === ui.playbackPreset.value);
    if (!preset) {
        ui.playbackDescription.textContent = "Select a preset to broadcast.";
        return;
    }
    const profile = CALL_PROFILES.find(p => p.id === preset.profileId);
    const translation = profile ? profile.translation : "";
    const behaviour = profile ? profile.behavior : "";
    ui.playbackDescription.textContent = `${preset.description}${translation ? ' | Translation: ' + translation : ''}${behaviour ? ' | Context: ' + behaviour : ''}`;
}

function updatePlaybackStatus(message, tone) {
    if (!ui.playbackStatus) return;
    ui.playbackStatus.textContent = message;
    ui.playbackStatus.classList.remove("idle", "active", "error");
    if (tone) {
        ui.playbackStatus.classList.add(tone);
    }
}

async function playSelectedCall() {
    const preset = PLAYBACK_LIBRARY.find(item => item.id === ui.playbackPreset.value);
    if (!preset) {
        updatePlaybackStatus("Select a preset", "idle");
        return;
    }
    const repeats = Number(ui.playbackRepeats.value) || 1;
    const repeatSpacing = Number(ui.playbackSpacing.value) / 1000;
    const gainValue = Number(ui.playbackGain.value) / 100;
    const ctx = ensurePlaybackContext();
    await ctx.resume();
    stopPlayback(false);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(gainValue, ctx.currentTime);
    masterGain.connect(ctx.destination);

    playbackState.context = ctx;
    playbackState.gain = masterGain;
    playbackState.sources = [];

    let startTime = ctx.currentTime + 0.05;
    for (let r = 0; r < repeats; r += 1) {
        for (const segment of preset.sequence) {
            if (segment.rest) {
                startTime += segment.rest;
                continue;
            }
            startTime = scheduleCallSegment(ctx, masterGain, segment, startTime);
            startTime += segment.gap ?? 0.18;
        }
        if (r < repeats - 1) {
            startTime += repeatSpacing;
        }
    }

    playbackState.active = true;
    playbackState.stopAt = startTime + 0.5;
    playbackState.status = "active";
    updatePlaybackStatus(`Broadcasting ${preset.label}`, "active");

    if (state.listening) {
        showStatus(`Broadcasting ${preset.label} sequence...`);
    }

    if (audioContext && playbackState.context === audioContext) {
        const remaining = Math.max(0, playbackState.stopAt - audioContext.currentTime);
        suppressDetection(remaining + 0.6);
    }
}

function stopPlayback(userInitiated) {
    playbackState.sources.forEach(source => {
        if (source && typeof source.stop === "function") {
            try { source.stop(0); } catch (error) { /* ignored */ }
        }
    });
    playbackState.sources = [];
    if (playbackState.gain) {
        try { playbackState.gain.disconnect(); } catch (error) { /* noop */ }
    }
    playbackState.gain = null;
    playbackState.active = false;
    playbackState.stopAt = 0;
    playbackState.context = null;

    if (userInitiated) {
        updatePlaybackStatus("Stopped", "idle");
    } else if (playbackState.status === "active") {
        updatePlaybackStatus("Idle", "idle");
    }
    playbackState.status = "idle";

    if (state.listening) {
        showStatus("Listening for vocalizations...");
    }

    if (audioContext) {
        suppressDetection(0.5);
    }
}

function scheduleCallSegment(ctx, outputGain, segment, startTime) {
    const duration = Math.max(0.12, segment.duration || 0.28);
    const amplitude = Math.max(0.05, segment.amplitude ?? 0.7);
    const baseFreq = Math.max(100, segment.baseFreq ?? 600);
    const freqSlide = segment.freqSlide ?? -140;
    const noiseLevel = Math.max(0, segment.noise ?? 0.3);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(baseFreq, startTime);
    filter.Q.setValueAtTime(segment.q ?? 4.2, startTime);

    const callGain = ctx.createGain();
    callGain.gain.setValueAtTime(0.0001, startTime);
    callGain.gain.linearRampToValueAtTime(amplitude, startTime + 0.03);
    callGain.gain.setValueAtTime(amplitude * 0.82, startTime + duration * 0.4);
    callGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    filter.connect(callGain);
    callGain.connect(outputGain);

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(baseFreq, startTime);
    osc.frequency.linearRampToValueAtTime(baseFreq + freqSlide, startTime + duration);
    osc.connect(filter);

    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(baseFreq * 0.5, startTime);
    osc2.frequency.linearRampToValueAtTime((baseFreq + freqSlide) * 0.5, startTime + duration);
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.35;
    osc2.connect(osc2Gain);
    osc2Gain.connect(filter);

    const noiseBuffer = ensureNoiseBuffer(ctx);
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(noiseLevel, startTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    noiseSource.connect(noiseGain);
    noiseGain.connect(filter);

    const stopTime = startTime + duration + 0.05;
    osc.start(startTime);
    osc.stop(stopTime);
    osc2.start(startTime);
    osc2.stop(stopTime);
    noiseSource.start(startTime);
    noiseSource.stop(stopTime);

    playbackState.sources.push(osc, osc2, noiseSource);

    return startTime + duration;
}

function ensureNoiseBuffer(ctx) {
    if (playbackState.noiseBuffer && playbackState.noiseBuffer.sampleRate === ctx.sampleRate) {
        return playbackState.noiseBuffer;
    }
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
    }
    playbackState.noiseBuffer = buffer;
    return buffer;
}

function ensurePlaybackContext() {
    if (audioContext) return audioContext;
    if (!playbackOnlyContext || playbackOnlyContext.state === "closed") {
        playbackOnlyContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return playbackOnlyContext;
}

function suppressDetection(durationSeconds) {
    if (!audioContext) return;
    const guard = Math.max(0, durationSeconds || 0);
    state.suppressDetectionUntil = Math.max(state.suppressDetectionUntil, audioContext.currentTime + guard);
    state.callActive = false;
    state.callHistory = [];
}



