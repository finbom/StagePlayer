import type { StagePlayerApi } from '../shared/types.js';

/** Bridge to the main process, exposed by the preload script. */
export const api = (window as unknown as { stagePlayer: StagePlayerApi }).stagePlayer;
