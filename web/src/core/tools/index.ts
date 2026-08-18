// ============================================================
// vibeAgentGo — Tools barrel (split from tools.ts in v2608.1.0)
// Public API: createDefaultTools(), extractVideoId
// ============================================================

import type { Tool } from '../../types/index.js';
export { extractVideoId } from './web_tools.js';
import { help } from './system_tools.js';
import { read_file, read_pdf, write_file, search_files, patch } from './file_tools.js';
import { run, run_code, run_app } from './run_tools.js';
import { web_search, youtube_transcript } from './web_tools.js';
import { app_store_search, app_store_install, app_store_publish } from './app_store_tools.js';
import { memory_save, memory_search, memory_delete, memory_update } from './memory_tools.js';
import { sys_check } from './sys_check.js';
import { error_log } from './error_log.js';
import { rename_session } from './rename_session.js';

export function createDefaultTools(): Tool[] {
  return [
    help,
    read_file,
    read_pdf,
    write_file,
    search_files,
    patch,
    run,
    run_code,
    run_app,
    web_search,
    youtube_transcript,
    app_store_search,
    app_store_install,
    app_store_publish,
    memory_save,
    memory_search,
    memory_delete,
    memory_update,
    rename_session,
    sys_check,
    error_log,
  ];
}
