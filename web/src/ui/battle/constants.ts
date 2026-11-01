import {SpriteConfig} from './utils/helper';

/**
 * Configuration for Frontline 1941
 */
export const CONFIG = {
  // Game Info
  title: {
    value: 'Frontline 1941',
    type: 'string',
    label: 'Game Title',
    group: 'GAME',
  },
  baseCanvasWidth: {
    value: 1280,
    type: 'number',
    label: 'Base Canvas Width',
    group: 'GAME',
  },
  baseCanvasHeight: {
    value: 720,
    type: 'number',
    label: 'Base Canvas Height',
    group: 'GAME',
  },

  // System Constants
  targetFPS: {
    value: 60,
    type: 'number',
    label: 'Target FPS',
    group: 'SYSTEM',
  },
  stepMs: {
    value: 1000 / 60,
    type: 'number',
    label: 'Step MS',
    group: 'SYSTEM',
  },
  maxSubSteps: {
    value: 5,
    type: 'number',
    label: 'Max Sub Steps',
    group: 'SYSTEM',
  },

  // Thematic Palette & Typography
  backgroundColor: {
    value: '#423840',
    type: 'color',
    label: 'Background Color',
    group: 'THEME',
  },
  primaryColor: {
    value: '#A1A258',
    type: 'color',
    label: 'Primary Brass Color',
    group: 'THEME',
  },
  fontFamily: {
    value: '"Courier New", monospace',
    type: 'string',
    label: 'Font Family',
    group: 'THEME',
  },

  // Audio Levels
  defaultMusicVolume: {
    value: 0.5,
    type: 'number',
    label: 'Default Music Volume',
    group: 'AUDIO',
  },
  defaultSfxVolume: {
    value: 0.7,
    type: 'number',
    label: 'Default SFX Volume',
    group: 'AUDIO',
  },

  // Rules & Gameplay Tuning (Exposed to playground_config.json)
  animationSpeed: {
    value: 1.0,
    type: 'number',
    label: 'Animation Speed',
    group: 'Rules',
  },
  shakeIntensity: {
    value: 1.0,
    type: 'number',
    label: 'Screen Shake Multiplier',
    group: 'Rules',
  },
  autoRollDelay: {
    value: 750,
    type: 'number',
    label: 'Auto Roll Delay (ms)',
    group: 'Rules',
  },
  startingFunds: {
    value: 40,
    type: 'number',
    label: 'Sandbox Budget',
    group: 'Rules',
  },
  diceRollDuration: {
    value: 600,
    type: 'number',
    label: 'Dice Tumbling Time (ms)',
    group: 'Rules',
  },
  enableDicePhysicsJuice: {
    value: true,
    type: 'boolean',
    label: 'Dice Physics Juice',
    group: 'Rules',
  },

  // Assets metadata integration
  assetBgNormandyAspectRatio: {
    value: 1.791666,
    type: 'number',
    label: 'European Test (Coast / Forest) Aspect Ratio',
    group: 'ASSETS',
  },
  assetBgEasternFrontAspectRatio: {
    value: 1.791666,
    type: 'number',
    label: 'Eastern Front Aspect Ratio',
    group: 'ASSETS',
  },
  assetBgNorthAfricaAspectRatio: {
    value: 1.791666,
    type: 'number',
    label: 'North Africa Aspect Ratio',
    group: 'ASSETS',
  },
  assetBgPacificHighSeasAspectRatio: {
    value: 1.791666,
    type: 'number',
    label: 'Pacific High Seas Aspect Ratio',
    group: 'ASSETS',
  },
  assetIconCombinedArmsAspectRatio: {
    value: 1.131868,
    type: 'number',
    label: 'Combined Arms Badge Aspect Ratio',
    group: 'ASSETS',
  },
  assetIconBrassD6AspectRatio: {
    value: 0.89514,
    type: 'number',
    label: 'Brass D6 Aspect Ratio',
    group: 'ASSETS',
  },

  playerSprite: {
    value: undefined as SpriteConfig | undefined,
    type: 'sprite',
    label: 'Player Sprite',
    group: 'Visuals',
  },
};

// Merge customized config values if present (injected by Playground)
const {playgroundConfig} = globalThis as {
  playgroundConfig?: Record<string, unknown>;
};
if (playgroundConfig) {
  for (const [key, value] of Object.entries(playgroundConfig)) {
    if (key in CONFIG) {
      Object.assign(CONFIG[key as keyof typeof CONFIG], {value});
    }
  }
}

/**
 * Type helper for reading values in game code
 */
export type ConfigKey = keyof typeof CONFIG;

/**
 * Gets a configuration value by key.
 * @param key The configuration key.
 * @return The configuration value.
 */
export function getConfig<K extends ConfigKey>(
  key: K,
): (typeof CONFIG)[K]['value'] {
  return CONFIG[key].value;
}

export const PRESETS = {};
