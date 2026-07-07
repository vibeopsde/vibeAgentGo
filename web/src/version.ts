// ============================================================
// vibeAgentGo — Version constant
// Format: vYYMM.xyz (xyz resets on new month)
// ============================================================

import pkg from '../../package.json' with { type: 'json' };

export const VERSION = `v${pkg.version}`;
