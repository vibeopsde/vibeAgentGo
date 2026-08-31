export type Language = 'de' | 'en';

interface Translations {
  [key: string]: string;
}

const de: Translations = {
  // Common
  'app.updateAvailable': 'Update verfügbar',
  'app.reload': 'Neu laden',
  'common.save': 'Speichern',
  'common.cancel': 'Abbrechen',
  'common.delete': 'Löschen',
  'common.rename': 'Umbenennen',
  'common.loading': 'Lädt...',
  'common.error': 'Fehler',
  'common.newChat': 'Neuer Chat',
  'common.render': 'Render',
  'common.chat': 'Chat',
  'common.turn': 'Runde',
  'common.thinking': 'Denkt nach...',
  'common.idle': 'Bereit',

  // Header
  'header.newChat': 'Neuer Chat',
  'header.memory': 'Memory',
  'header.theme': 'Design',

  // Chat
  'chat.placeholder': 'Nachricht an vibeAgentGo... (Enter = Zeilenumbruch, Shift+Enter = senden)',
  'chat.attachFile': 'Datei anhängen',
  'chat.sessions': 'Sessions',
  'chat.removeAttachment': 'Anhang entfernen',
  'chat.toolCall': 'Tool-Aufruf',
  'chat.send': 'Senden',
  'chat.stop': 'Stopp',
  'chat.fileTooLarge': 'Datei zu groß (max 10 MB)',
  'chat.fileReadError': 'Datei konnte nicht gelesen werden',
  'chat.copyCode': 'Kopieren',

  // Settings
  'settings.title': 'Einstellungen',
  'settings.provider': 'Provider',
  'settings.providerHint': 'Fester Provider — Base URL wird automatisch gesetzt.',
  'settings.model': 'Modell',
  'settings.apiKey': 'API Key',
  'settings.maxTurns': 'Max Turns',
  'settings.language': 'Sprache',
  'settings.sounds': 'System-Sounds',
  'settings.soundsHint': '🔊 Akustische Signale bei Tool-Aufrufen und Fertig-Meldung',
  'settings.editorTabSize': 'Editor Tab-Größe',
  'settings.unknownProvider':
    'Gespeicherter Provider passt zu keinem Preset ({url}). Beim Speichern wird der oben gewählte Provider übernommen.',
  'settings.search': 'Search Provider',
  'settings.searchNone': 'Deaktiviert',
  'settings.searchTavily': 'Tavily',
  'settings.searchApiKey': 'Search API Key',
  'settings.tabLLM': 'LLM',
  'settings.tabAppearance': 'Erscheinungsbild',
  'settings.connectionSuccess': 'Verbindung OK',
  'settings.connectionError': 'Verbindung fehlgeschlagen',
  'settings.providerInfo': 'Jeder OpenAI-kompatible Endpoint mit CORS funktioniert.',
  'settings.resetData': 'Alle lokalen Daten löschen',
  'settings.resetConfirm':
    'Das löscht alle Sessions, Dateien, Memory-Einträge und Einstellungen aus diesem Browser. Das kann nicht rückgängig gemacht werden.',
  'settings.resetCancel': 'Abbrechen',
  'settings.resetConfirmBtn': 'Ja, alles löschen',
  'settings.data': 'Daten & Sicherheit',
  'settings.about': 'Über',
  'about.tagline': 'Vollständig client-seitiger KI-Agent. Alle Daten bleiben im Browser.',
  'about.techStack': 'Tech-Stack',
  'about.builtWith': 'Entwickelt mit',
  'about.builtWithText': 'Programmiert mit Hermes unter Ubuntu Linux mit GLM 5.2 / Kimi K3.',
  'about.links': 'Links',
  'settings.backup': 'Backup & Wiederherstellen',
  'settings.backupIncludeKeys': 'API-Keys im Backup einschließen',
  'settings.export': 'Backup exportieren',
  'settings.import': 'Backup importieren',
  'settings.exportSuccess': 'Backup erfolgreich heruntergeladen',
  'settings.exportError': 'Backup konnte nicht erstellt werden',
  'settings.importConfirm':
    'Dies überschreibt alle aktuellen Daten (Sessions, Memory, Dateien, Einstellungen). Fortfahren?',
  'settings.importSuccess': 'Backup erfolgreich wiederhergestellt. Seite wird neu geladen.',
  'settings.importError': 'Backup konnte nicht wiederhergestellt werden',
  // Onboarding
  'onboarding.welcome': 'Willkommen bei vibeAgentGo',
  'onboarding.restore': 'Wiederherstellen',
  'onboarding.subtitle': 'vibeAgentGo — dein KI-Agent, der komplett im Browser läuft.',
  'onboarding.next': 'Weiter',
  'onboarding.back': 'Zurück',
  'onboarding.finish': 'vibeAgentGo starten',
  'onboarding.languageHint': 'Die Sprache wird für die Benutzeroberfläche und die System-Prompts verwendet.',
  'onboarding.llmTitle': 'KI-Schnittstelle',
  'onboarding.llmHint': 'Wähle einen Provider.',
  'onboarding.searchHint':
    'Optional: Aktiviere Websuche über Tavily. Du kannst dies später in den Einstellungen ändern.',
  'onboarding.apiKeyHint': 'Bei lokalen Endpunkten kann das Feld leer bleiben.',
  'onboarding.apiKeyRequired': 'API-Key für diesen Provider erforderlich.',
  'onboarding.verifyFirst': 'Bitte zuerst Verbindung testen',
  'onboarding.pickModel': 'Modell wählen...',
  'onboarding.noModelsManual': 'Keine Modelle gelistet — manuell eingeben',
  'onboarding.dataSovereigntyTitle': 'Datenhoheit',
  'onboarding.dataSovereigntyText':
    'Alle Sessions, Dateien und Memory liegen in deinem Browser (IndexedDB). Nur LLM-Anfragen verlassen das Gerät.',
  'onboarding.toolsTitle': 'Tools im Browser',
  'onboarding.toolsText':
    'Dateien lesen/schreiben, Code ausführen, Websuchen, Erinnerungen speichern und interaktive HTML-Views rendern.',
  'onboarding.openaiTitle': 'OpenAI-kompatibel',
  'onboarding.openaiText':
    'vibeAgentGo spricht mit OpenAI-kompatiblen Endpunkten über feste Provider-Presets mit CORS-Proxy.',
  'onboarding.testConnection': 'Verbindung testen',

  // Memory
  'memory.userProfile': 'Nutzerprofil',
  'memory.memories': 'Erinnerungen',
  'memory.empty': 'Noch keine Erinnerungen.',

  // Sessions
  'sessions.title': 'Sessions',
  'sessions.empty': 'Noch keine Sessions.',

  // Explorer
  'explorer.title': 'Explorer',
  'explorer.newFile': 'Neue Datei',
  'explorer.newFolder': 'Neuer Ordner',
  'explorer.upload': 'Hochladen',
  'explorer.duplicate': 'Duplizieren',
  'explorer.download': 'Herunterladen',
  'explorer.search': 'Dateien suchen...',
  'explorer.noResults': 'Keine Dateien gefunden',
  'explorer.root': 'Root',
  'explorer.newFolderPrompt': 'Name des neuen Ordners (z. B. mein-ordner):',
  'explorer.fileExists': 'Datei existiert bereits.',
  'explorer.folderExists': 'Ordner existiert bereits.',
  'explorer.confirmDelete': '{path} löschen?',
  'explorer.confirmDeleteFolder': 'Ordner {path} und alle Inhalte löschen?',
  'explorer.renamePrompt': 'Datei umbenennen:',
  'explorer.renameFolderPrompt': 'Ordner umbenennen:',
  'explorer.empty': 'Noch keine Dateien.',
  'explorer.refresh': 'Aktualisieren',
  'explorer.invalidPath': 'Ungültiger Pfad: verwende relative Namen ohne "..", Backslash oder Steuerzeichen.',

  // Editor
  'editor.untitled': 'Unbenannt',
  'editor.save': 'Speichern',
  'editor.saved': 'Gespeichert',
  'editor.saveError': 'Speichern fehlgeschlagen',
  'editor.loaded': 'Geladen',
  'editor.unsavedChanges': 'Ungespeicherte Änderungen verwerfen?',
  'editor.newFile': 'Neue Datei',
  'editor.saveAs': 'Speichern unter',
  'editor.newFilePrompt': 'Name der neuen Datei?',
  'editor.saveAsPrompt': 'Dateiname zum Speichern?',
  'editor.fileExists': 'Datei existiert bereits. Überschreiben?',
  'editor.newFileCreated': 'Neue Datei erstellt',
  'editor.findPlaceholder': 'Suchen...',
  'editor.replacePlaceholder': 'Ersetzen...',
  'editor.findPrev': 'Vorheriger Treffer',
  'editor.findNext': 'Nächster Treffer',
  'editor.closeFind': 'Schließen (Esc)',
  'editor.replaceOne': 'Ersetzen',
  'editor.replaceAll': 'Alle ersetzen',

  // Errors
  'error.noModel': 'Bitte Modell angeben.',
  'error.noApiKey': 'Bitte API Key eingeben.',
  'error.noBaseUrl': 'Bitte Base URL eingeben.',
  'error.loadSession': 'Fehler beim Laden der Session:',

  // Chat
  'chat.unknownSlashCommand': 'Unbekannter Slash-Befehl. Tippe `/help` für verfügbare Befehle.',

  // App Store
  'appstore.title': 'App Store',
  'appstore.loading': 'App Store wird geladen...',
  'appstore.error': 'App Store konnte nicht geladen werden',
  'appstore.refresh': 'Aktualisieren',
  'appstore.all': 'Alle',
  'appstore.install': 'Installieren',
  'appstore.installing': 'Wird installiert...',
  'appstore.installError': 'Installation fehlgeschlagen',
  'appstore.uninstall': 'Deinstallieren',
  'appstore.launch': 'Starten',
  'appstore.update': 'Update',
  'appstore.updateAll': 'Alle updaten',
  'appstore.updatesAvailable': '{count} Update(s) verfügbar',
  'appstore.installedVersion': 'Installiert: v{version}',
  'appstore.noPermissions': 'Keine Berechtigungen nötig',
  'appstore.permissions': 'Berechtigungen',
  'appstore.empty': 'Keine Apps verfügbar.',
  'appstore.tabStore': 'Store',
  'appstore.tabInstalled': 'Meine Apps',
  'appstore.noInstalledApps': 'Noch keine Apps installiert. Im Store findest du alle.',

  // Workspaces
  'workspace.tabLabel': 'Workspaces',
  'workspace.title': 'Workspaces',
  'workspace.hint':
    'Jeder Workspace hat eine eigene Datenbank mit Sessions, Dateien und Memory. Provider-Einstellungen bleiben geteilt.',
  'workspace.create': 'Erstellen',
  'workspace.newName': 'Neuer Workspace',
  'workspace.newNamePlaceholder': 'z. B. Projekt Alpha',
  'workspace.switch': 'Wechseln',
  'workspace.active': 'Aktiv',
  'workspace.renamePrompt': 'Workspace umbenennen:',
  'workspace.deleteConfirm':
    'Workspace "{name}" und alle darin enthaltenen Daten (Sessions, Dateien, Memory) wirklich löschen?',
  'workspace.cannotDeleteLast': 'Der letzte Workspace kann nicht gelöscht werden.',
  'settings.dangerZone': 'Gefahrenzone',
};

const en: Translations = {
  // Common
  'app.updateAvailable': 'Update available',
  'app.reload': 'Reload',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.rename': 'Rename',
  'common.loading': 'Loading...',
  'common.error': 'Error',
  'common.newChat': 'New Chat',
  'common.render': 'Render',
  'common.chat': 'Chat',
  'common.turn': 'Turn',
  'common.thinking': 'Thinking...',
  'common.idle': 'Ready',

  // Header
  'header.newChat': 'New Chat',
  'header.memory': 'Memory',
  'header.theme': 'Theme',

  // Chat
  'chat.placeholder': 'Message vibeAgentGo... (Enter = newline, Shift+Enter = send)',
  'chat.attachFile': 'Attach file',
  'chat.sessions': 'Sessions',
  'chat.removeAttachment': 'Remove attachment',
  'chat.toolCall': 'Tool call',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.fileTooLarge': 'File too large (max 10 MB)',
  'chat.fileReadError': 'Failed to read file',
  'chat.copyCode': 'Copy',

  // Settings
  'settings.title': 'Settings',
  'settings.provider': 'Provider',
  'settings.providerHint': 'Fixed provider — base URL is set automatically.',
  'settings.model': 'Model',
  'settings.apiKey': 'API Key',
  'settings.maxTurns': 'Max Turns',
  'settings.language': 'Language',
  'settings.sounds': 'System sounds',
  'settings.soundsHint': '🔊 Audible signals on tool calls and completion',
  'settings.editorTabSize': 'Editor tab size',
  'settings.unknownProvider':
    'Saved provider does not match any preset ({url}). Saving will apply the provider selected above.',
  'settings.search': 'Search Provider',
  'settings.searchNone': 'Disabled',
  'settings.searchTavily': 'Tavily',
  'settings.searchApiKey': 'Search API Key',
  'settings.tabLLM': 'LLM',
  'settings.tabAppearance': 'Appearance',
  'settings.connectionSuccess': 'Connection OK',
  'settings.connectionError': 'Connection failed',
  'settings.providerInfo': 'Any OpenAI-compatible endpoint with CORS will work.',
  'settings.resetData': 'Delete all local data',
  'settings.resetConfirm':
    'This deletes all sessions, files, memories and settings from this browser. Cannot be undone.',
  'settings.resetCancel': 'Cancel',
  'settings.resetConfirmBtn': 'Yes, delete everything',
  'settings.data': 'Data & Safety',
  'settings.about': 'About',
  'about.tagline': 'Fully client-side AI agent. All data stays in your browser.',
  'about.techStack': 'Tech Stack',
  'about.builtWith': 'Built With',
  'about.builtWithText': 'Programmed with Hermes on Ubuntu Linux using GLM 5.2 / Kimi K3.',
  'about.links': 'Links',
  'settings.backup': 'Backup & Restore',
  'settings.backupIncludeKeys': 'Include API keys in backup',
  'settings.export': 'Export backup',
  'settings.import': 'Import backup',
  'settings.exportSuccess': 'Backup downloaded successfully',
  'settings.exportError': 'Could not create backup',
  'settings.importConfirm': 'This will overwrite all current data (sessions, memory, files, settings). Continue?',
  'settings.importSuccess': 'Backup restored successfully. Reloading page.',
  'settings.importError': 'Could not restore backup',
  // Onboarding
  'onboarding.welcome': 'Welcome to vibeAgentGo',
  'onboarding.restore': 'Restore',
  'onboarding.subtitle': 'vibeAgentGo — your AI agent that runs entirely in the browser.',
  'onboarding.next': 'Next',
  'onboarding.back': 'Back',
  'onboarding.finish': 'Start vibeAgentGo',
  'onboarding.languageHint': 'This language will be used for the UI and system prompts.',
  'onboarding.llmTitle': 'Connect LLM',
  'onboarding.llmHint': 'Choose a provider.',
  'onboarding.searchHint': 'Optional: Enable web search via Tavily. You can change this later in Settings.',
  'onboarding.apiKeyHint': 'For local endpoints this field can be left empty.',
  'onboarding.apiKeyRequired': 'API key required for this provider.',
  'onboarding.verifyFirst': 'Please test connection first',
  'onboarding.pickModel': 'Pick model...',
  'onboarding.noModelsManual': 'No models listed — enter manually',
  'onboarding.dataSovereigntyTitle': 'Data sovereignty',
  'onboarding.dataSovereigntyText':
    'All sessions, files, and memories stay in your browser (IndexedDB). Only LLM requests leave the device.',
  'onboarding.toolsTitle': 'Browser tools',
  'onboarding.toolsText': 'Read/write files, run code, web search, save memories, and render interactive HTML views.',
  'onboarding.openaiTitle': 'OpenAI-compatible',
  'onboarding.openaiText':
    'vibeAgentGo connects to OpenAI-compatible endpoints via fixed provider presets with a CORS proxy.',
  'onboarding.testConnection': 'Test connection',

  // Memory
  'memory.userProfile': 'User Profile',
  'memory.memories': 'Memories',
  'memory.empty': 'No memories yet.',

  // Sessions
  'sessions.title': 'Sessions',
  'sessions.empty': 'No sessions yet.',

  // Explorer
  'explorer.title': 'Explorer',
  'explorer.newFile': 'New File',
  'explorer.newFolder': 'New Folder',
  'explorer.upload': 'Upload',
  'explorer.duplicate': 'Duplicate',
  'explorer.download': 'Download',
  'explorer.search': 'Search files...',
  'explorer.noResults': 'No files found',
  'explorer.root': 'Root',
  'explorer.newFolderPrompt': 'New folder name (e.g. my-folder):',
  'explorer.fileExists': 'File already exists.',
  'explorer.folderExists': 'Folder already exists.',
  'explorer.confirmDelete': 'Delete {path}?',
  'explorer.invalidPath': 'Invalid path: use relative names without "..", backslashes or control characters.',
  'explorer.confirmDeleteFolder': 'Delete folder {path} and all its contents?',
  'explorer.renamePrompt': 'Rename file:',
  'explorer.renameFolderPrompt': 'Rename folder:',
  'explorer.empty': 'No files yet.',
  'explorer.refresh': 'Refresh',

  // Editor
  'editor.untitled': 'Untitled',
  'editor.save': 'Save',
  'editor.saved': 'Saved',
  'editor.saveError': 'Save failed',
  'editor.loaded': 'Loaded',
  'editor.unsavedChanges': 'Discard unsaved changes?',
  'editor.newFile': 'New File',
  'editor.saveAs': 'Save As',
  'editor.newFilePrompt': 'Name for new file?',
  'editor.saveAsPrompt': 'File name to save?',
  'editor.fileExists': 'File already exists. Overwrite?',
  'editor.newFileCreated': 'New file created',
  'editor.findPlaceholder': 'Find...',
  'editor.replacePlaceholder': 'Replace...',
  'editor.findPrev': 'Previous match',
  'editor.findNext': 'Next match',
  'editor.closeFind': 'Close (Esc)',
  'editor.replaceOne': 'Replace',
  'editor.replaceAll': 'Replace All',

  // Errors
  'error.noModel': 'Please provide a model.',
  'error.noApiKey': 'Please provide an API key.',
  'error.noBaseUrl': 'Please provide a base URL.',
  'error.loadSession': 'Failed to load session:',

  // Chat
  'chat.unknownSlashCommand': 'Unknown slash command. Type `/help` for available commands.',

  // App Store
  'appstore.title': 'App Store',
  'appstore.loading': 'Loading App Store...',
  'appstore.error': 'Failed to load App Store',
  'appstore.refresh': 'Refresh',
  'appstore.all': 'All',
  'appstore.install': 'Install',
  'appstore.installing': 'Installing...',
  'appstore.installError': 'Install failed',
  'appstore.uninstall': 'Uninstall',
  'appstore.launch': 'Launch',
  'appstore.update': 'Update',
  'appstore.updateAll': 'Update all',
  'appstore.updatesAvailable': '{count} update(s) available',
  'appstore.installedVersion': 'Installed: v{version}',
  'appstore.noPermissions': 'No permissions required',
  'appstore.permissions': 'Permissions',
  'appstore.empty': 'No apps available.',
  'appstore.tabStore': 'Store',
  'appstore.tabInstalled': 'My Apps',
  'appstore.noInstalledApps': 'No apps installed yet. Browse the Store to install some.',

  // Workspaces
  'workspace.tabLabel': 'Workspaces',
  'workspace.title': 'Workspaces',
  'workspace.hint':
    'Each workspace has its own database with sessions, files, and memory. Provider settings stay shared.',
  'workspace.create': 'Create',
  'workspace.newName': 'New Workspace',
  'workspace.newNamePlaceholder': 'e.g. Project Alpha',
  'workspace.switch': 'Switch',
  'workspace.active': 'Active',
  'workspace.renamePrompt': 'Rename workspace:',
  'workspace.deleteConfirm': 'Delete workspace "{name}" and all its data (sessions, files, memory)?',
  'workspace.cannotDeleteLast': 'Cannot delete the last workspace.',
  'settings.dangerZone': 'Danger Zone',
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
