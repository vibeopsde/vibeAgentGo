// ============================================================
// vibeAgentGo — PWA Main Entry
// All bootstrap logic lives in AppController.
// ============================================================

import './styles/app.css';
import './core/cors_fetch.js';
import { AppController } from './core/AppController.js';

const controller = new AppController();
controller.start();
