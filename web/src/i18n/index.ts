export type Language = 'de' | 'en';

interface Translations {
  [key: string]: string;
}

const de: Translations = {
  // Common
  'app.title': 'vibeAgentGo',
  'common.save': 'Speichern',
  'common.cancel': 'Abbrechen',
  'common.close': 'Schließen',
  'common.delete': 'Löschen',
  'common.loading': 'Lädt...',
  'common.error': 'Fehler',
  'common.newChat': 'Neuer Chat',
  'common.render': 'Render',
  'common.chat': 'Chat',
  'common.turn': 'Runde',
  'common.menu': 'Menü',
  'common.thinking': 'Denkt nach...',
  'common.idle': 'Bereit',
  'common.edit': 'Bearbeiten',

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
  'chat.toolCall': 'Tool-Aufruf',

  // Settings
  'settings.title': 'Einstellungen',
  'settings.provider': 'Provider',
  'settings.providerHint': 'Fester Provider — Base URL wird automatisch gesetzt.',
  'settings.ollamaCloud': 'Ollama Cloud',
  'settings.ollamaCloudUrl': 'https://vag.vibeops.de/api/ollama/v1',
  'settings.model': 'Modell',
  'settings.baseUrl': 'Base URL',
  'settings.apiKey': 'API Key',
  'settings.maxTurns': 'Max Turns',
  'settings.language': 'Sprache',
  'settings.search': 'Search Provider',
  'settings.searchNone': 'Deaktiviert',
  'settings.searchTavily': 'Tavily',
  'settings.searchApiKey': 'Search API Key',
  'settings.tabLLM': 'LLM',
  'settings.tabSearch': 'Suche',
  'settings.tabAppearance': 'Erscheinungsbild',
  'settings.tabMemory': 'Memory',
  'settings.tabSkills': 'Skills',
  'settings.tabBackup': 'Backup',
  'settings.tabDanger': 'Gefahrenzone',
  'settings.testConnection': 'Verbindung testen',
  'settings.connectionSuccess': 'Verbindung OK',
  'settings.connectionError': 'Verbindung fehlgeschlagen',
  'settings.providerInfo': 'Jeder OpenAI-kompatible Endpoint mit CORS funktioniert.',
  'settings.resetData': 'Alle lokalen Daten löschen',
  'settings.resetConfirm':
    'Das löscht alle Sessions, Dateien, Memory-Einträge, Skills und Einstellungen aus diesem Browser. Das kann nicht rückgängig gemacht werden.',
  'settings.resetCancel': 'Abbrechen',
  'settings.resetConfirmBtn': 'Ja, alles löschen',
  'settings.backup': 'Backup & Wiederherstellen',
  'settings.backupIncludeKeys': 'API-Keys im Backup einschließen',
  'settings.export': 'Backup exportieren',
  'settings.import': 'Backup importieren',
  'settings.exportSuccess': 'Backup erfolgreich heruntergeladen',
  'settings.exportError': 'Backup konnte nicht erstellt werden',
  'settings.importConfirm':
    'Dies überschreibt alle aktuellen Daten (Sessions, Memory, Skills, Dateien, Einstellungen). Fortfahren?',
  'settings.importSuccess': 'Backup erfolgreich wiederhergestellt. Seite wird neu geladen.',
  'settings.importError': 'Backup konnte nicht wiederhergestellt werden',

  // Onboarding
  'onboarding.welcome': 'Willkommen bei vibeAgentGo',
  'onboarding.restore': 'Wiederherstellen',
  'onboarding.subtitle': 'vibeAgentGo — dein KI-Agent, der komplett im Browser läuft.',
  'onboarding.next': 'Weiter',
  'onboarding.back': 'Zurück',
  'onboarding.finish': 'vibeAgentGo starten',
  'onboarding.languageTitle': 'Sprache wählen',
  'onboarding.languageHint': 'Die Sprache wird für die Benutzeroberfläche und die System-Prompts verwendet.',
  'onboarding.llmTitle': 'KI-Schnittstelle',
  'onboarding.llmHint': 'Wähle einen Provider.',
  'onboarding.searchHint':
    'Optional: Aktiviere Websuche über Tavily. Du kannst dies später in den Einstellungen ändern.',
  'onboarding.apiKeyHint': 'Bei lokalen Endpunkten kann das Feld leer bleiben.',
  'onboarding.apiKeyRequired': 'API-Key für diesen Provider erforderlich.',
  'onboarding.verifyFirst': 'Bitte zuerst Verbindung testen',
  'onboarding.verifyFailed': 'Verifizierung fehlgeschlagen',
  'onboarding.pickModel': 'Modell wählen...',
  'onboarding.noModelsManual': 'Keine Modelle gelistet — manuell eingeben',
  'onboarding.dataSovereigntyTitle': 'Datenhoheit',
  'onboarding.dataSovereigntyText':
    'Alle Sessions, Dateien, Memory und Skills liegen in deinem Browser (IndexedDB). Nur LLM-Anfragen verlassen das Gerät.',
  'onboarding.toolsTitle': 'Tools im Browser',
  'onboarding.toolsText':
    'Dateien lesen/schreiben, Code ausführen, Websuchen, Erinnerungen speichern und interaktive HTML-Views rendern.',
  'onboarding.openaiTitle': 'OpenAI-kompatibel',
  'onboarding.openaiText':
    'vibeAgentGo spricht mit OpenAI-kompatiblen Endpunkten über feste Provider-Presets mit CORS-Proxy.',
  'onboarding.modelList': 'Modelle',
  'onboarding.testConnection': 'Verbindung testen',

  // Memory
  'memory.title': 'Memory',
  'memory.local': 'lokal im Browser',
  'memory.userProfile': 'Nutzerprofil',
  'memory.memories': 'Erinnerungen',
  'memory.empty': 'Noch keine Erinnerungen.',

  // Sessions
  'sessions.title': 'Sessions',
  'sessions.empty': 'Noch keine Sessions.',
  'sessions.resume': 'Fortsetzen',

  // Render
  'render.title': 'Render View',
  'render.emptyHint': 'Der Agent kann hier HTML-Mini-Apps anzeigen.',

  // Explorer
  'explorer.title': 'Explorer',
  'explorer.newFile': 'Neue Datei',
  'explorer.newFilePrompt': 'Name der neuen Datei (z. B. notes.md):',
  'explorer.fileExists': 'Datei existiert bereits.',
  'explorer.confirmDelete': '{path} löschen?',
  'explorer.empty': 'Noch keine Dateien.',
  'explorer.refresh': 'Aktualisieren',

  // Editor
  'editor.title': 'Editor',
  'editor.untitled': 'Unbenannt',
  'editor.save': 'Speichern',
  'editor.saved': 'Gespeichert',
  'editor.saveError': 'Speichern fehlgeschlagen',
  'editor.loaded': 'Geladen',
  'editor.unsavedChanges': 'Ungespeicherte Änderungen verwerfen?',

  // Skills
  'skills.title': 'Skills',
  'skills.hint':
    'Projekt-Style Skills: Markdown mit Trigger-Wörtern. Passen den System-Prompt an, wenn ein Trigger im Chat fällt.',
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
  'error.loadSession': 'Fehler beim Laden der Session:',
};

const en: Translations = {
  // Common
  'app.title': 'vibeAgentGo',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.loading': 'Loading...',
  'common.error': 'Error',
  'common.newChat': 'New Chat',
  'common.render': 'Render',
  'common.chat': 'Chat',
  'common.turn': 'Turn',
  'common.menu': 'Menu',
  'common.thinking': 'Thinking...',
  'common.idle': 'Ready',
  'common.edit': 'Edit',

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
  'chat.toolCall': 'Tool call',

  // Settings
  'settings.title': 'Settings',
  'settings.provider': 'Provider',
  'settings.providerHint': 'Fixed provider — base URL is set automatically.',
  'settings.ollamaCloud': 'Ollama Cloud',
  'settings.ollamaCloudUrl': 'https://vag.vibeops.de/api/ollama/v1',
  'settings.model': 'Model',
  'settings.baseUrl': 'Base URL',
  'settings.apiKey': 'API Key',
  'settings.maxTurns': 'Max Turns',
  'settings.language': 'Language',
  'settings.search': 'Search Provider',
  'settings.searchNone': 'Disabled',
  'settings.searchTavily': 'Tavily',
  'settings.searchApiKey': 'Search API Key',
  'settings.tabLLM': 'LLM',
  'settings.tabSearch': 'Search',
  'settings.tabAppearance': 'Appearance',
  'settings.tabMemory': 'Memory',
  'settings.tabSkills': 'Skills',
  'settings.tabBackup': 'Backup',
  'settings.tabDanger': 'Danger Zone',
  'settings.testConnection': 'Test Connection',
  'settings.connectionSuccess': 'Connection OK',
  'settings.connectionError': 'Connection failed',
  'settings.providerInfo': 'Any OpenAI-compatible endpoint with CORS will work.',
  'settings.resetData': 'Delete all local data',
  'settings.resetConfirm':
    'This deletes all sessions, files, memories, skills and settings from this browser. Cannot be undone.',
  'settings.resetCancel': 'Cancel',
  'settings.resetConfirmBtn': 'Yes, delete everything',
  'settings.backup': 'Backup & Restore',
  'settings.backupIncludeKeys': 'Include API keys in backup',
  'settings.export': 'Export backup',
  'settings.import': 'Import backup',
  'settings.exportSuccess': 'Backup downloaded successfully',
  'settings.exportError': 'Could not create backup',
  'settings.importConfirm':
    'This will overwrite all current data (sessions, memory, skills, files, settings). Continue?',
  'settings.importSuccess': 'Backup restored successfully. Reloading page.',
  'settings.importError': 'Could not restore backup',

  // Onboarding
  'onboarding.welcome': 'Welcome to vibeAgentGo',
  'onboarding.restore': 'Restore',
  'onboarding.subtitle': 'vibeAgentGo — your AI agent that runs entirely in the browser.',
  'onboarding.next': 'Next',
  'onboarding.back': 'Back',
  'onboarding.finish': 'Start vibeAgentGo',
  'onboarding.languageTitle': 'Choose language',
  'onboarding.languageHint': 'This language will be used for the UI and system prompts.',
  'onboarding.llmTitle': 'Connect LLM',
  'onboarding.llmHint': 'Choose a provider.',
  'onboarding.searchHint': 'Optional: Enable web search via Tavily. You can change this later in Settings.',
  'onboarding.apiKeyHint': 'For local endpoints this field can be left empty.',
  'onboarding.apiKeyRequired': 'API key required for this provider.',
  'onboarding.verifyFirst': 'Please test connection first',
  'onboarding.verifyFailed': 'Verification failed',
  'onboarding.pickModel': 'Pick model...',
  'onboarding.noModelsManual': 'No models listed — enter manually',
  'onboarding.dataSovereigntyTitle': 'Data sovereignty',
  'onboarding.dataSovereigntyText':
    'All sessions, files, memories and skills stay in your browser (IndexedDB). Only LLM requests leave the device.',
  'onboarding.toolsTitle': 'Browser tools',
  'onboarding.toolsText': 'Read/write files, run code, web search, save memories, and render interactive HTML views.',
  'onboarding.openaiTitle': 'OpenAI-compatible',
  'onboarding.openaiText':
    'vibeAgentGo connects to OpenAI-compatible endpoints via fixed provider presets with a CORS proxy.',
  'onboarding.modelList': 'Models',
  'onboarding.testConnection': 'Test connection',

  // Memory
  'memory.title': 'Memory',
  'memory.local': 'local in browser',
  'memory.userProfile': 'User Profile',
  'memory.memories': 'Memories',
  'memory.empty': 'No memories yet.',

  // Sessions
  'sessions.title': 'Sessions',
  'sessions.empty': 'No sessions yet.',
  'sessions.resume': 'Resume',

  // Render
  'render.title': 'Render View',
  'render.emptyHint': 'The agent can render HTML mini-apps here.',

  // Explorer
  'explorer.title': 'Explorer',
  'explorer.newFile': 'New File',
  'explorer.newFilePrompt': 'New file name (e.g. notes.md):',
  'explorer.fileExists': 'File already exists.',
  'explorer.confirmDelete': 'Delete {path}?',
  'explorer.empty': 'No files yet.',
  'explorer.refresh': 'Refresh',

  // Editor
  'editor.title': 'Editor',
  'editor.untitled': 'Untitled',
  'editor.save': 'Save',
  'editor.saved': 'Saved',
  'editor.saveError': 'Save failed',
  'editor.loaded': 'Loaded',
  'editor.unsavedChanges': 'Discard unsaved changes?',

  // Skills
  'skills.title': 'Skills',
  'skills.hint':
    'Project-style skills: Markdown with trigger words. They adapt the system prompt when a trigger appears in chat.',
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
  'error.loadSession': 'Failed to load session:',
};

const translations: Record<Language, Translations> = { de, en };
let currentLanguage: Language = normalizeLanguage(navigator.language);

export function normalizeLanguage(lang: unknown): Language {
  const s = String(lang || '').toLowerCase();
  if (s.startsWith('en')) return 'en';
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
