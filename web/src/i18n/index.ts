export type Language = 'de' | 'en';

interface Translations {
  [key: string]: string;
}

const de: Translations = {
  // Common
  'app.title': 'vibeAgentGo',
  'app.tagline': 'Hermes Agent Go',
  'common.save': 'Speichern',
  'common.cancel': 'Abbrechen',
  'common.close': 'Schließen',
  'common.delete': 'Löschen',
  'common.add': 'Hinzufügen',
  'common.loading': 'Lädt...',
  'common.error': 'Fehler',
  'common.success': 'Erfolg',
  'common.retry': 'Wiederholen',
  'common.settings': 'Einstellungen',
  'common.newChat': 'Neuer Chat',
  'common.memory': 'Memory',
  'common.sessions': 'Sessions',
  'common.render': 'Render',
  'common.chat': 'Chat',
  'common.turn': 'Runde',
  'common.menu': 'Menü',
  'common.send': 'Senden',
  'common.thinking': 'Denkt nach...',
  'common.idle': 'Bereit',
  'common.edit': 'Bearbeiten',
  'common.disconnected': 'Getrennt',
  'common.connected': 'Verbunden',

  // Header
  'header.settings': 'Einstellungen',
  'header.newChat': 'Neuer Chat',
  'header.memory': 'Memory',
  'header.skills': 'Skills',
  'header.sessions': 'Sessions',
  'header.theme': 'Design',

  // Chat
  'chat.placeholder': 'Nachricht an vibeAgentGo...',
  'chat.attachFile': 'Datei anhängen',
  'chat.removeAttachment': 'Anhang entfernen',
  'chat.empty': 'Starte eine Unterhaltung',
  'chat.toolCall': 'Tool-Aufruf',
  'chat.toolResult': 'Ergebnis',
  'chat.unknownTool': 'Unbekanntes Tool',
  'chat.maxTurns': 'Maximale Rundenanzahl erreicht.',
  'chat.aborted': 'Abgebrochen.',

  // Settings
  'settings.title': 'Einstellungen',
  'settings.llm': 'LLM-Konfiguration',
  'settings.provider': 'Provider Preset',
  'settings.providerHint': 'Preset trägt Modell + Base URL ein. API Key musst du selbst einfügen.',
  'settings.custom': 'Benutzerdefiniert',
  'settings.openrouter': 'OpenRouter',
  'settings.opencode': 'OpenCode (go/zen)',
  'settings.ollamaCloud': 'Ollama Cloud',
  'settings.openrouterUrl': 'https://openrouter.ai/api/v1',
  'settings.opencodeUrl': 'https://opencode.go/zen',
  'settings.ollamaCloudUrl': 'https://ollama.cloud/v1',
  'settings.model': 'Modell',
  'settings.baseUrl': 'Base URL',
  'settings.apiKey': 'API Key',
  'settings.maxTurns': 'Max Turns',
  'settings.maxTurnsHint': 'Maximale Anzahl aufeinanderfolgender LLM-Aufrufe pro Anfrage.',
  'settings.language': 'Sprache',
  'settings.german': 'Deutsch',
  'settings.english': 'English',
  'settings.search': 'Search Provider',
  'settings.searchNone': 'Deaktiviert',
  'settings.searchTavily': 'Tavily',
  'settings.searchApiKey': 'Search API Key',
  'settings.testConnection': 'Verbindung testen',
  'settings.connectionSuccess': 'Verbindung OK',
  'settings.connectionError': 'Verbindung fehlgeschlagen',
  'settings.providerInfo': 'Jeder OpenAI-kompatible Endpoint mit CORS funktioniert.',
  'settings.examples': 'Beispiele:',
  'settings.openrouterExample': 'OpenRouter: https://openrouter.ai/api/v1',
  'settings.opencodeExample': 'OpenCode (go/zen): https://opencode.go/zen',
  'settings.ollamaCloudExample': 'Ollama Cloud: https://ollama.cloud/v1',
  'settings.resetData': 'Alle lokalen Daten löschen',
  'settings.resetConfirm': 'Das löscht alle Sessions, Dateien, Memory-Einträge, Skills und Einstellungen aus diesem Browser. Das kann nicht rückgängig gemacht werden.',
  'settings.resetCancel': 'Abbrechen',
  'settings.resetConfirmBtn': 'Ja, alles löschen',
  'settings.backup': 'Backup & Wiederherstellen',
  'settings.backupIncludeKeys': 'API-Keys im Backup einschließen',
  'settings.export': 'Backup exportieren',
  'settings.import': 'Backup importieren',
  'settings.exportSuccess': 'Backup erfolgreich heruntergeladen',
  'settings.exportError': 'Backup konnte nicht erstellt werden',
  'settings.importConfirm': 'Dies überschreibt alle aktuellen Daten (Sessions, Memory, Skills, Dateien, Einstellungen). Fortfahren?',
  'settings.importSuccess': 'Backup erfolgreich wiederhergestellt. Seite wird neu geladen.',
  'settings.importError': 'Backup konnte nicht wiederhergestellt werden',

  // Onboarding
  'onboarding.welcome': 'Willkommen bei vibeAgentGo',
  'onboarding.restore': 'Wiederherstellen',
  'onboarding.subtitle': 'Hermes Agent Go — dein KI-Agent, der komplett im Browser läuft.',
  'onboarding.next': 'Weiter',
  'onboarding.back': 'Zurück',
  'onboarding.finish': 'vibeAgentGo starten',
  'onboarding.stepWelcome': 'Willkommen',
  'onboarding.stepLanguage': 'Sprache',
  'onboarding.stepLLM': 'LLM',
  'onboarding.stepSearch': 'Suche',
  'onboarding.languageTitle': 'Sprache wählen',
  'onboarding.languageHint': 'Die Sprache wird für die Benutzeroberfläche und die System-Prompts verwendet.',
  'onboarding.llmTitle': 'KI-Schnittstelle',
  'onboarding.llmHint': 'Wähle einen Provider oder trage deine Endpunktdaten manuell ein.',
  'onboarding.verifyTitle': 'Verbindung testen',
  'onboarding.verifyHint': 'Wähle ein Modell aus der Liste oder gib es manuell ein.',
  'onboarding.searchHint': 'Optional: Aktiviere Websuche über Tavily. Du kannst dies später in den Einstellungen ändern.',
  'onboarding.apiKeyHint': 'Bei lokalen Endpunkten kann das Feld leer bleiben.',
  'onboarding.manual': 'Manuell',
  'onboarding.verifyFirst': 'Bitte zuerst Verbindung testen',
  'onboarding.verifyFailed': 'Verifizierung fehlgeschlagen',
  'onboarding.pickModel': 'Modell wählen...',
  'onboarding.noModelsManual': 'Keine Modelle gelistet — manuell eingeben',
  'onboarding.dataSovereigntyTitle': 'Datenhoheit',
  'onboarding.dataSovereigntyText': 'Alle Sessions, Dateien, Memory und Skills liegen in deinem Browser (IndexedDB). Nur LLM-Anfragen verlassen das Gerät.',
  'onboarding.toolsTitle': 'Tools im Browser',
  'onboarding.toolsText': 'Dateien lesen/schreiben, Code ausführen, Websuchen, Erinnerungen speichern und interaktive HTML-Views rendern.',
  'onboarding.openaiTitle': 'OpenAI-kompatibel',
  'onboarding.openaiText': 'vibeAgentGo spricht mit jedem OpenAI-kompatiblen Endpunkt. OpenAI, Ollama, OpenRouter — du wählst.',
  'onboarding.modelList': 'Modelle',
  'onboarding.modelManual': 'Manuelles Modell',
  'onboarding.modelPlaceholder': 'model-id',
  'onboarding.testConnection': 'Verbindung testen',
  'onboarding.connectionSuccess': 'Verbindung OK',
  'onboarding.connectionError': 'Verbindung fehlgeschlagen',

  // Memory
  'memory.title': 'Memory',
  'memory.local': 'lokal im Browser',
  'memory.userProfile': 'Nutzerprofil',
  'memory.memories': 'Erinnerungen',
  'memory.empty': 'Noch keine Erinnerungen.',
  'memory.addProfile': 'Profil-Eintrag hinzufügen',
  'memory.addMemory': 'Erinnerung hinzufügen',
  'memory.placeholder': 'Neuer Eintrag...',

  // Sessions
  'sessions.title': 'Sessions',
  'sessions.empty': 'Noch keine Sessions.',
  'sessions.resume': 'Fortsetzen',
  'sessions.delete': 'Löschen',

  // Render
  'render.title': 'Render View',
  'render.empty': 'Noch keine View gerendert.',
  'render.emptyHint': 'Der Agent kann hier HTML-Mini-Apps anzeigen.',

  // Skills
  'skills.title': 'Skills',
  'skills.hint': 'Projekt-Style Skills: Markdown mit Trigger-Wörtern. Passen den System-Prompt an, wenn ein Trigger im Chat fällt.',
  'skills.empty': 'Noch keine Skills. Erstelle einen Skill mit Trigger-Wörtern.',
  'skills.new': 'Neuer Skill',
  'skills.edit': 'Skill bearbeiten',
  'skills.name': 'Name',
  'skills.description': 'Beschreibung',
  'skills.triggers': 'Trigger-Wörter',
  'skills.triggersHint': 'Komma-getrennt. Bei Treffer im Chat wird der Skill automatisch aktiviert.',
  'skills.body': 'Skill-Body',
  'skills.deleteConfirm': 'Diesen Skill wirklich löschen?',

  // Errors
  'error.noModel': 'Bitte Modell angeben.',
  'error.noApiKey': 'Bitte API Key eingeben.',
  'error.noBaseUrl': 'Bitte Base URL eingeben.',
  'error.loadConfig': 'Konfiguration konnte nicht geladen werden.',
  'error.loadSession': 'Fehler beim Laden der Session:',
  'error.agentRunning': 'Agent läuft bereits. Bitte warten oder abbrechen.',
  'error.searchNoApiKey': 'Bitte Search API Key eingeben oder Suche deaktivieren.',
};

const en: Translations = {
  // Common
  'app.title': 'vibeAgentGo',
  'app.tagline': 'Hermes Agent Go',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.add': 'Add',
  'common.loading': 'Loading...',
  'common.edit': 'Edit',
  'common.error': 'Error',
  'common.success': 'Success',
  'common.retry': 'Retry',
  'common.settings': 'Settings',
  'common.newChat': 'New Chat',
  'common.memory': 'Memory',
  'common.sessions': 'Sessions',
  'common.render': 'Render',
  'common.chat': 'Chat',
  'common.turn': 'Turn',
  'common.menu': 'Menu',
  'common.send': 'Send',
  'common.thinking': 'Thinking...',
  'common.idle': 'Ready',
  'common.disconnected': 'Disconnected',
  'common.connected': 'Connected',

  // Header
  'header.settings': 'Settings',
  'header.newChat': 'New Chat',
  'header.memory': 'Memory',
  'header.skills': 'Skills',
  'header.sessions': 'Sessions',
  'header.theme': 'Theme',

  // Chat
  'chat.placeholder': 'Message vibeAgentGo...',
  'chat.attachFile': 'Attach file',
  'chat.removeAttachment': 'Remove attachment',
  'chat.empty': 'Start a conversation',
  'chat.toolCall': 'Tool call',
  'chat.toolResult': 'Result',
  'chat.unknownTool': 'Unknown tool',
  'chat.user': 'You',
  'chat.maxTurns': 'Maximum turns reached.',
  'chat.aborted': 'Aborted.',
  // Settings
  'settings.title': 'Settings',
  'settings.llm': 'LLM Configuration',
  'settings.provider': 'Provider Preset',
  'settings.providerHint': 'Preset fills in model + base URL. You must add your own API key.',
  'settings.custom': 'Custom',
  'settings.openrouter': 'OpenRouter',
  'settings.opencode': 'OpenCode (go/zen)',
  'settings.ollamaCloud': 'Ollama Cloud',
  'settings.openrouterUrl': 'https://openrouter.ai/api/v1',
  'settings.opencodeUrl': 'https://opencode.go/zen',
  'settings.ollamaCloudUrl': 'https://ollama.cloud/v1',
  'settings.model': 'Model',
  'settings.baseUrl': 'Base URL',
  'settings.apiKey': 'API Key',
  'settings.maxTurns': 'Max Turns',
  'settings.maxTurnsHint': 'Maximum number of consecutive LLM calls per request.',
  'settings.language': 'Language',
  'settings.german': 'Deutsch',
  'settings.english': 'English',
  'settings.search': 'Search Provider',
  'settings.searchNone': 'Disabled',
  'settings.searchTavily': 'Tavily',
  'settings.searchApiKey': 'Search API Key',
  'settings.testConnection': 'Test Connection',
  'settings.connectionSuccess': 'Connection OK',
  'settings.connectionError': 'Connection failed',
  'settings.providerInfo': 'Any OpenAI-compatible endpoint with CORS will work.',
  'settings.examples': 'Examples:',
  'settings.openrouterExample': 'OpenRouter: https://openrouter.ai/api/v1',
  'settings.opencodeExample': 'OpenCode (go/zen): https://opencode.go/zen',
  'settings.ollamaCloudExample': 'Ollama Cloud: https://ollama.cloud/v1',
  'settings.resetData': 'Delete all local data',
  'settings.resetConfirm': 'This deletes all sessions, files, memories, skills and settings from this browser. Cannot be undone.',
  'settings.resetCancel': 'Cancel',
  'settings.resetConfirmBtn': 'Yes, delete everything',
  'settings.backup': 'Backup & Restore',
  'settings.backupIncludeKeys': 'Include API keys in backup',
  'settings.export': 'Export backup',
  'settings.import': 'Import backup',
  'settings.exportSuccess': 'Backup downloaded successfully',
  'settings.exportError': 'Could not create backup',
  'settings.importConfirm': 'This will overwrite all current data (sessions, memory, skills, files, settings). Continue?',
  'settings.importSuccess': 'Backup restored successfully. Reloading page.',
  'settings.importError': 'Could not restore backup',

  // Onboarding
  'onboarding.welcome': 'Welcome to vibeAgentGo',
  'onboarding.restore': 'Restore',
  'onboarding.subtitle': 'Hermes Agent Go — your AI agent that runs entirely in the browser.',
  'onboarding.next': 'Next',
  'onboarding.back': 'Back',
  'onboarding.finish': 'Start vibeAgentGo',
  'onboarding.stepWelcome': 'Welcome',
  'onboarding.stepLanguage': 'Language',
  'onboarding.stepLLM': 'LLM',
  'onboarding.stepSearch': 'Search',
  'onboarding.languageTitle': 'Choose language',
  'onboarding.languageHint': 'This language will be used for the UI and system prompts.',
  'onboarding.llmTitle': 'Connect LLM',
  'onboarding.llmHint': 'Choose a provider or enter your endpoint data manually.',
  'onboarding.verifyTitle': 'Test connection',
  'onboarding.verifyHint': 'Pick a model from the list or enter it manually.',
  'onboarding.searchHint': 'Optional: Enable web search via Tavily. You can change this later in Settings.',
  'onboarding.apiKeyHint': 'For local endpoints this field can be left empty.',
  'onboarding.manual': 'Manual',
  'onboarding.verifyFirst': 'Please test connection first',
  'onboarding.verifyFailed': 'Verification failed',
  'onboarding.pickModel': 'Pick model...',
  'onboarding.noModelsManual': 'No models listed — enter manually',
  'onboarding.dataSovereigntyTitle': 'Data sovereignty',
  'onboarding.dataSovereigntyText': 'All sessions, files, memories and skills stay in your browser (IndexedDB). Only LLM requests leave the device.',
  'onboarding.toolsTitle': 'Browser tools',
  'onboarding.toolsText': 'Read/write files, run code, web search, save memories, and render interactive HTML views.',
  'onboarding.openaiTitle': 'OpenAI-compatible',
  'onboarding.openaiText': 'vibeAgentGo talks to any OpenAI-compatible endpoint. OpenAI, Ollama, OpenRouter — your choice.',
  'onboarding.modelList': 'Models',
  'onboarding.modelManual': 'Manual model',
  'onboarding.modelPlaceholder': 'model-id',
  'onboarding.testConnection': 'Test connection',
  'onboarding.connectionSuccess': 'Connection OK',
  'onboarding.connectionError': 'Connection failed',

  // Memory
  'memory.title': 'Memory',
  'memory.local': 'local in browser',
  'memory.userProfile': 'User Profile',
  'memory.memories': 'Memories',
  'memory.empty': 'No memories yet.',
  'memory.addProfile': 'Add profile entry',
  'memory.addMemory': 'Add memory',
  'memory.placeholder': 'New entry...',

  // Sessions
  'sessions.title': 'Sessions',
  'sessions.empty': 'No sessions yet.',
  'sessions.resume': 'Resume',
  'sessions.delete': 'Delete',

  // Render
  'render.title': 'Render View',
  'render.empty': 'No render view yet.',
  'render.emptyHint': 'The agent can render HTML mini-apps here.',

  // Skills
  'skills.title': 'Skills',
  'skills.hint': 'Project-style skills: Markdown with trigger words. They adapt the system prompt when a trigger appears in chat.',
  'skills.empty': 'No skills yet. Create a skill with trigger words.',
  'skills.new': 'New Skill',
  'skills.edit': 'Edit Skill',
  'skills.name': 'Name',
  'skills.description': 'Description',
  'skills.triggers': 'Trigger Words',
  'skills.triggersHint': 'Comma-separated. When matched in chat, the skill is automatically activated.',
  'skills.body': 'Skill Body',
  'skills.deleteConfirm': 'Delete this skill?',

  // Errors
  'error.noModel': 'Please provide a model.',
  'error.noApiKey': 'Please provide an API key.',
  'error.noBaseUrl': 'Please provide a base URL.',
  'error.loadConfig': 'Configuration could not be loaded.',
  'error.loadSession': 'Failed to load session:',
  'error.agentRunning': 'Agent is already running. Please wait or abort.',
  'error.searchNoApiKey': 'Please provide a search API key or disable search.',
};

const translations: Record<Language, Translations> = { de, en };
let currentLanguage: Language = 'de';

export function normalizeLanguage(lang: unknown): Language {
  if (lang === 'en') return 'en';
  return 'de';
}

export function setLanguage(lang: Language | string | undefined | null): void {
  currentLanguage = normalizeLanguage(lang);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = currentLanguage;
  }
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function getAvailableLanguages(): { value: Language; label: string }[] {
  return [
    { value: 'de', label: 'Deutsch' },
    { value: 'en', label: 'English' },
  ];
}

export function t(key: string, fallback?: string): string {
  const value = translations[currentLanguage][key] ?? translations['de'][key] ?? fallback;
  return value ?? key;
}

export function translate(key: string, fallback?: string): string {
  return t(key, fallback);
}
