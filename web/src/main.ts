// ============================================================
// vibeAgentGo — PWA Main Entry
// All bootstrap logic lives in AppController.
// ============================================================

import './styles/app.css';
import { AppController } from './core/AppController.js';

const controller = new AppController();
controller.start();
