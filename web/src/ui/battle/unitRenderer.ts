// Frontline 1941 - Tactical Combat Unit & Battlefield Visual Renderer
import {
  CombatUnit,
  TheaterId,
  GroundCrater,
  GroundFire,
  BloodPuddle,
  BloodSplatter,
  FlyingDebris,
  SmokePuff,
  Shockwave,
  PlaneSortie,
  PlaneBullet,
  FloatingText,
  CasualtyRecord,
  WaterGeyser,
} from './combatTypes';

/**
 * STRICT 16-COLOR VINTAGE MILITARY PALETTE
 */
export const PALETTE = {
  sandCream: '#DFCE91',       // 1. Light Sand / Cream
  sandTan: '#CAA574',         // 2. Sand Tan
  terracotta: '#B77958',      // 3. Warm Terracotta / Clay
  crimson: '#9A4E48',         // 4. Muted Soviet Brick / Crimson
  plum: '#6F3B4A',            // 5. Deep Wine / Plum
  bunkerCharcoal: '#423840',  // 6. Dark Bunker Charcoal
  navalSteel: '#495462',      // 7. Naval Steel / Slate Blue
  spruceSea: '#527A71',       // 8. Spruce / Sea Green
  fieldSage: '#8DA082',       // 9. Field Sage / Grass
  deepTaupe: '#5E4E54',       // 10. Deep Taupe / Trench Dark
  feldgrau: '#857577',        // 11. Feldgrau / Ash Taupe
  trenchMudBone: '#A69C90',   // 12. Trench Mud Light / Bone
  oliveDrab: '#72745C',       // 13. Olive Drab / Uniform Green
  mustardBrass: '#A1A258',    // 14. Mustard Brass / Ochre
  earthBrown: '#7D6652',      // 15. Earth Dirt / Brown
  khakiLeather: '#9E7F55',    // 16. Khaki Leather
} as const;

/**
 * Deterministic star positions for the night sky
 */
const STARS = Array.from({length: 48}, (_, i) => ({
  x: ((i * 137.5) % 1260) + 10,
  y: ((i * 31.7) % 75) + 6,
  size: i % 5 === 0 ? 2 : 1,
  seed: i * 1.618,
}));

// ============================================================================
// CONTINUOUS RGB SKY TRANSITION ENGINE (60-SECOND CYCLE)
// ============================================================================

type RGB = [number, number, number];

function lerpRGB(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t),
  ];
}

function rgbStr(c: RGB, a = 1): string {
  return a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

interface SkyKeyframe {
  pos: number;
  top: RGB;
  mid: RGB;
  horizon: RGB;
}

const SKY_KEYFRAMES: SkyKeyframe[] = [
  // 0.00: High Noon (Day blue / warm cream)
  {
    pos: 0.0,
    top: [116, 140, 165],
    mid: [195, 185, 155],
    horizon: [228, 218, 160],
  },
  // 0.35: Late Afternoon
  {
    pos: 0.35,
    top: [104, 124, 146],
    mid: [204, 168, 122],
    horizon: [232, 186, 114],
  },
  // 0.46: Warm Golden-Orange Sunset
  {
    pos: 0.46,
    top: [94, 60, 84],
    mid: [214, 112, 54],
    horizon: [244, 166, 58],
  },
  // 0.54: Twilight into Nightfall
  {
    pos: 0.54,
    top: [46, 36, 52],
    mid: [54, 58, 76],
    horizon: [72, 82, 98],
  },
  // 0.68: Deep Navy / Charcoal Night
  {
    pos: 0.68,
    top: [22, 24, 32],
    mid: [30, 36, 48],
    horizon: [40, 50, 64],
  },
  // 0.86: Soft Dawn / First Light
  {
    pos: 0.86,
    top: [34, 40, 56],
    mid: [82, 64, 82],
    horizon: [142, 92, 84],
  },
  // 0.94: Golden Sunrise
  {
    pos: 0.94,
    top: [86, 108, 128],
    mid: [186, 142, 106],
    horizon: [226, 186, 130],
  },
  // 1.00: Wrap around to High Noon
  {
    pos: 1.0,
    top: [116, 140, 165],
    mid: [195, 185, 155],
    horizon: [228, 218, 160],
  },
];

function getSkyColors(cycle: number): {top: RGB; mid: RGB; horizon: RGB} {
  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    const k1 = SKY_KEYFRAMES[i];
    const k2 = SKY_KEYFRAMES[i + 1];
    if (cycle >= k1.pos && cycle <= k2.pos) {
      const t = (cycle - k1.pos) / (k2.pos - k1.pos);
      return {
        top: lerpRGB(k1.top, k2.top, t),
        mid: lerpRGB(k1.mid, k2.mid, t),
        horizon: lerpRGB(k1.horizon, k2.horizon, t),
      };
    }
  }
  return {
    top: SKY_KEYFRAMES[0].top,
    mid: SKY_KEYFRAMES[0].mid,
    horizon: SKY_KEYFRAMES[0].horizon,
  };
}

// ============================================================================
// AMBIENT OCCLUSION & DROP SHADOW HELPER
// ============================================================================

/**
 * Draws an actual smooth ambient occlusion contact shadow underneath units,
 * vehicles, trees, and ground craters for realistic depth and grounding.
 */
export function drawAmbientOcclusionShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  contactWidth = rx * 1.2,
  alpha = 1.0,
) {
  if (alpha <= 0.005) return;
  ctx.save();
  if (alpha < 0.999) {
    ctx.globalAlpha = (ctx.globalAlpha || 1.0) * alpha;
  }
  // Soft radial ambient occlusion drop shadow
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, rx));
  grad.addColorStop(0, 'rgba(20, 16, 22, 0.75)');
  grad.addColorStop(0.45, 'rgba(28, 22, 28, 0.45)');
  grad.addColorStop(0.8, 'rgba(40, 32, 38, 0.15)');
  grad.addColorStop(1, 'rgba(40, 32, 38, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
  ctx.fill();

  // Dark contact crease line directly along the footprint
  ctx.fillStyle = 'rgba(12, 10, 14, 0.85)';
  ctx.fillRect(cx - contactWidth / 2, cy - 1, contactWidth, 2);
  ctx.restore();
}

/**
 * Renders the top skybox with smooth, gradual 60-second Day / Sunset / Night / Dawn
 * color interpolation, actual radial gradient bloom on celestial bodies, and
 * ambient occlusion beneath the horizon tree line.
 */
export function drawSkyboxAndTreeline(
  ctx: CanvasRenderingContext2D,
  width: number,
  time: number,
) {
  const horizonY = 114;
  const cycleSeconds = 60;
  const cycle = (time % cycleSeconds) / cycleSeconds; // 0.0 to 1.0 continuous

  ctx.save();

  // 1. SMOOTH RGB SKY GRADIENT
  const {top, mid, horizon} = getSkyColors(cycle);
  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, rgbStr(top));
  skyGrad.addColorStop(0.55, rgbStr(mid));
  skyGrad.addColorStop(1, rgbStr(horizon));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, horizonY);

  // 2. STARS (Gradually fade in during night: cycle 0.48 .. 0.92)
  let nightness = 0;
  if (cycle >= 0.48 && cycle <= 0.92) {
    nightness = Math.sin(((cycle - 0.48) / 0.44) * Math.PI);
  }
  if (nightness > 0.02) {
    STARS.forEach((st) => {
      const twinkle = Math.sin(time * 3.5 + st.seed);
      if (twinkle > -0.2) {
        ctx.fillStyle = twinkle > 0.4 ? PALETTE.sandCream : PALETTE.trenchMudBone;
        ctx.globalAlpha = nightness * Math.max(0.1, (twinkle + 0.3) * 0.7);
        ctx.fillRect(st.x, st.y, st.size, st.size);
      }
    });
    ctx.globalAlpha = 1.0;
  }

  // 3. SUN (Arches smoothly across the sky during Day & Sunset: cycle 0.86 .. 0.54)
  let sunP = -1;
  if (cycle >= 0.86) {
    sunP = (cycle - 0.86) / 0.68;
  } else if (cycle <= 0.54) {
    sunP = (cycle + 0.14) / 0.68;
  }

  if (sunP >= 0 && sunP <= 1) {
    const sunX = Math.round(50 + sunP * (width - 100));
    const sunY = Math.round(horizonY - 12 - Math.sin(sunP * Math.PI) * 78);
    const sunAlpha = Math.max(0, Math.sin(sunP * Math.PI));
    const isSunset = sunP > 0.62;

    // ACTUAL RADIAL GRADIENT BLOOM FOR SUN (lighter blend)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sunBloomR = 48;
    const sBloom = ctx.createRadialGradient(sunX, sunY, 3, sunX, sunY, sunBloomR);
    if (isSunset) {
      sBloom.addColorStop(0, `rgba(255, 210, 110, ${0.9 * sunAlpha})`);
      sBloom.addColorStop(0.25, `rgba(245, 130, 45, ${0.55 * sunAlpha})`);
      sBloom.addColorStop(0.7, `rgba(210, 70, 20, ${0.2 * sunAlpha})`);
      sBloom.addColorStop(1, 'rgba(180, 40, 10, 0)');
    } else {
      sBloom.addColorStop(0, `rgba(255, 245, 195, ${0.85 * sunAlpha})`);
      sBloom.addColorStop(0.3, `rgba(245, 195, 105, ${0.45 * sunAlpha})`);
      sBloom.addColorStop(0.7, `rgba(215, 140, 50, ${0.15 * sunAlpha})`);
      sBloom.addColorStop(1, 'rgba(180, 90, 20, 0)');
    }
    ctx.fillStyle = sBloom;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunBloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Solid Sun Core
    ctx.save();
    ctx.globalAlpha = sunAlpha;
    ctx.fillStyle = isSunset ? PALETTE.terracotta : PALETTE.sandCream;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.sandCream;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 4. MOON (Arches smoothly across the sky during Night: cycle 0.48 .. 0.94)
  if (cycle >= 0.48 && cycle <= 0.94) {
    const moonP = (cycle - 0.48) / 0.46;
    const moonX = Math.round(60 + moonP * (width - 120));
    const moonY = Math.round(horizonY - 12 - Math.sin(moonP * Math.PI) * 72);
    const moonAlpha = Math.max(0, Math.sin(moonP * Math.PI));

    // ACTUAL RADIAL GRADIENT BLOOM FOR MOON (lighter blend)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const moonBloomR = 36;
    const mBloom = ctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, moonBloomR);
    mBloom.addColorStop(0, `rgba(210, 235, 255, ${0.75 * moonAlpha})`);
    mBloom.addColorStop(0.35, `rgba(140, 180, 220, ${0.3 * moonAlpha})`);
    mBloom.addColorStop(0.75, `rgba(70, 100, 150, ${0.1 * moonAlpha})`);
    mBloom.addColorStop(1, 'rgba(30, 50, 90, 0)');
    ctx.fillStyle = mBloom;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonBloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Glowing Moon crescent disc
    ctx.save();
    ctx.globalAlpha = moonAlpha;
    ctx.fillStyle = PALETTE.sandCream;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 6, 0, Math.PI * 2);
    ctx.fill();
    // Crescent cutout
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.beginPath();
    ctx.arc(moonX + 2, moonY - 1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 5. DRIFTING ATMOSPHERIC CLOUDS
  const clouds = [
    {baseX: 80, y: 16, w: 72, h: 14},
    {baseX: 380, y: 32, w: 96, h: 16},
    {baseX: 720, y: 18, w: 84, h: 15},
    {baseX: 1040, y: 28, w: 110, h: 18},
  ];
  const cloudAlpha = 0.65 - nightness * 0.35;
  ctx.save();
  ctx.globalAlpha = cloudAlpha;
  clouds.forEach((cl) => {
    const cx = Math.round((cl.baseX + time * 7) % (width + cl.w * 2) - cl.w);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(cx + 8, cl.y, cl.w - 16, cl.h - 4);
    ctx.fillRect(cx + 18, cl.y - 4, cl.w - 38, 4);
    ctx.fillStyle = PALETTE.trenchMudBone;
    ctx.fillRect(cx + 4, cl.y + cl.h - 5, cl.w - 8, 4);
  });
  ctx.restore();

  // 6. ACTUAL AMBIENT OCCLUSION CONTACT SHADOW BENEATH TREE LINE
  const treeAo = ctx.createLinearGradient(0, horizonY - 6, 0, horizonY + 8);
  treeAo.addColorStop(0, 'rgba(20, 16, 22, 0.7)');
  treeAo.addColorStop(0.5, 'rgba(30, 24, 32, 0.35)');
  treeAo.addColorStop(1, 'rgba(30, 24, 32, 0)');
  ctx.fillStyle = treeAo;
  ctx.fillRect(0, horizonY - 6, width, 14);

  // 7. HORIZON FOREST SILHOUETTE
  drawForestSilhouette(ctx, width, horizonY);

  ctx.restore();
}

function drawForestSilhouette(
  ctx: CanvasRenderingContext2D,
  width: number,
  baseY: number,
) {
  // Background tree row (deep bunker charcoal silhouette & deep spruce sea)
  for (let x = -8; x < width + 24; x += 18) {
    const seed = Math.sin(x * 9.17) * 1000;
    const isPine = (Math.abs(Math.floor(seed)) % 2) === 0;
    const treeH = 22 + (Math.abs(Math.floor(seed * 0.4)) % 14);
    const ty = baseY - treeH;

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(x + 5, baseY - 8, 3, 8);

    if (isPine) {
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x + 5, ty, 3, 4);
      ctx.fillRect(x + 3, ty + 4, 7, 5);
      ctx.fillRect(x + 1, ty + 9, 11, 6);
      ctx.fillRect(x - 1, ty + 15, 15, 7);
    } else {
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(x + 1, ty + 2, 11, treeH - 6);
      ctx.fillRect(x + 3, ty, 7, 4);
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x + 2, ty + 3, 9, treeH - 8);
    }
  }

  // Foreground tree row (#72745C oliveDrab, #8DA082 fieldSage, #527A71 spruceSea)
  for (let x = 0; x < width + 20; x += 14) {
    const seed = Math.cos(x * 13.33) * 1000;
    const isPine = (Math.abs(Math.floor(seed)) % 3) !== 0;
    const treeH = 18 + (Math.abs(Math.floor(seed * 0.5)) % 12);
    const ty = baseY - treeH;

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(x + 4, baseY - 6, 2, 6);

    if (isPine) {
      ctx.fillStyle = PALETTE.fieldSage;
      ctx.fillRect(x + 4, ty, 2, 2);
      ctx.fillStyle = PALETTE.oliveDrab;
      ctx.fillRect(x + 3, ty + 2, 4, 3);
      ctx.fillStyle = PALETTE.fieldSage;
      ctx.fillRect(x + 3, ty + 5, 2, 2);
      ctx.fillStyle = PALETTE.oliveDrab;
      ctx.fillRect(x + 1, ty + 6, 8, 4);
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x - 1, ty + 10, 12, 6);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(x, ty + 14, 10, 2);
    } else {
      ctx.fillStyle = PALETTE.fieldSage;
      ctx.fillRect(x + 2, ty, 6, 3);
      ctx.fillStyle = PALETTE.oliveDrab;
      ctx.fillRect(x, ty + 3, 10, treeH - 8);
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(x + 1, ty + 5, 8, treeH - 10);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(x + 1, baseY - 7, 8, 2);
    }
  }

  // Embankment seam right above rank headers
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(0, baseY - 2, width, 4);
  ctx.fillStyle = PALETTE.spruceSea;
  for (let x = 0; x < width; x += 6) {
    ctx.fillRect(x, baseY - 3, 3, 2);
  }
}

/**
 * Seagull flight profiles for maritime skybox
 */
const SEAGULLS = [
  { baseX: 80, y: 35, speed: 18, flapRate: 8, seed: 0, dir: 1 },
  { baseX: 130, y: 42, speed: 16, flapRate: 7.5, seed: 1.2, dir: 1 },
  { baseX: 105, y: 50, speed: 19, flapRate: 8.2, seed: 2.5, dir: 1 },
  { baseX: 540, y: 28, speed: 15, flapRate: 7, seed: 3.8, dir: 1 },
  { baseX: 860, y: 46, speed: -17, flapRate: 8, seed: 4.4, dir: -1 },
  { baseX: 910, y: 55, speed: -16, flapRate: 7.8, seed: 5.6, dir: -1 },
];

/**
 * Renders the open sea skybox for NAVY TEST and high seas maps.
 * Completely eliminates the forest tree line!
 * In place of trees, renders distant rocky/tropical pixel islands with sandbars
 * and animated seagulls flying across the sky with 2-frame flapping V-wings.
 */
export function drawSeaSkyboxAndHorizon(
  ctx: CanvasRenderingContext2D,
  width: number,
  time: number,
) {
  const horizonY = 114;
  const cycleSeconds = 60;
  const cycle = (time % cycleSeconds) / cycleSeconds; // 0.0 to 1.0 continuous

  ctx.save();

  // 1. SMOOTH RGB SKY GRADIENT
  const {top, mid, horizon} = getSkyColors(cycle);
  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, rgbStr(top));
  skyGrad.addColorStop(0.55, rgbStr(mid));
  skyGrad.addColorStop(1, rgbStr(horizon));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, horizonY);

  // 2. STARS (Gradually fade in during night: cycle 0.48 .. 0.92)
  let nightness = 0;
  if (cycle >= 0.48 && cycle <= 0.92) {
    nightness = Math.sin(((cycle - 0.48) / 0.44) * Math.PI);
  }
  if (nightness > 0.02) {
    STARS.forEach((st) => {
      const twinkle = Math.sin(time * 3.5 + st.seed);
      if (twinkle > -0.2) {
        ctx.fillStyle = twinkle > 0.4 ? PALETTE.sandCream : PALETTE.trenchMudBone;
        ctx.globalAlpha = nightness * Math.max(0.1, (twinkle + 0.3) * 0.7);
        ctx.fillRect(st.x, st.y, st.size, st.size);
      }
    });
    ctx.globalAlpha = 1.0;
  }

  // 3. SUN
  let sunP = -1;
  if (cycle >= 0.86) {
    sunP = (cycle - 0.86) / 0.68;
  } else if (cycle <= 0.54) {
    sunP = (cycle + 0.14) / 0.68;
  }

  if (sunP >= 0 && sunP <= 1) {
    const sunX = Math.round(50 + sunP * (width - 100));
    const sunY = Math.round(horizonY - 12 - Math.sin(sunP * Math.PI) * 78);
    const sunAlpha = Math.max(0, Math.sin(sunP * Math.PI));
    const isSunset = sunP > 0.62;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sunBloomR = 48;
    const sBloom = ctx.createRadialGradient(sunX, sunY, 3, sunX, sunY, sunBloomR);
    if (isSunset) {
      sBloom.addColorStop(0, `rgba(255, 210, 110, ${0.9 * sunAlpha})`);
      sBloom.addColorStop(0.25, `rgba(245, 130, 45, ${0.55 * sunAlpha})`);
      sBloom.addColorStop(0.7, `rgba(210, 70, 20, ${0.2 * sunAlpha})`);
      sBloom.addColorStop(1, 'rgba(180, 40, 10, 0)');
    } else {
      sBloom.addColorStop(0, `rgba(255, 245, 195, ${0.85 * sunAlpha})`);
      sBloom.addColorStop(0.3, `rgba(245, 195, 105, ${0.45 * sunAlpha})`);
      sBloom.addColorStop(0.7, `rgba(215, 140, 50, ${0.15 * sunAlpha})`);
      sBloom.addColorStop(1, 'rgba(180, 90, 20, 0)');
    }
    ctx.fillStyle = sBloom;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunBloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = sunAlpha;
    ctx.fillStyle = isSunset ? PALETTE.terracotta : PALETTE.sandCream;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.sandCream;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 4. MOON
  if (cycle >= 0.48 && cycle <= 0.94) {
    const moonP = (cycle - 0.48) / 0.46;
    const moonX = Math.round(60 + moonP * (width - 120));
    const moonY = Math.round(horizonY - 12 - Math.sin(moonP * Math.PI) * 72);
    const moonAlpha = Math.max(0, Math.sin(moonP * Math.PI));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const moonBloomR = 36;
    const mBloom = ctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, moonBloomR);
    mBloom.addColorStop(0, `rgba(210, 235, 255, ${0.75 * moonAlpha})`);
    mBloom.addColorStop(0.35, `rgba(140, 180, 220, ${0.3 * moonAlpha})`);
    mBloom.addColorStop(0.75, `rgba(70, 100, 150, ${0.1 * moonAlpha})`);
    mBloom.addColorStop(1, 'rgba(30, 50, 90, 0)');
    ctx.fillStyle = mBloom;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonBloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = moonAlpha;
    ctx.fillStyle = PALETTE.sandCream;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.beginPath();
    ctx.arc(moonX + 2, moonY - 1, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 5. DRIFTING ATMOSPHERIC CLOUDS
  const clouds = [
    {baseX: 80, y: 16, w: 72, h: 14},
    {baseX: 380, y: 32, w: 96, h: 16},
    {baseX: 720, y: 18, w: 84, h: 15},
    {baseX: 1040, y: 28, w: 110, h: 18},
  ];
  const cloudAlpha = 0.65 - nightness * 0.35;
  ctx.save();
  ctx.globalAlpha = cloudAlpha;
  clouds.forEach((cl) => {
    const cx = Math.round((cl.baseX + time * 7) % (width + cl.w * 2) - cl.w);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(cx + 8, cl.y, cl.w - 16, cl.h - 4);
    ctx.fillRect(cx + 18, cl.y - 4, cl.w - 38, 4);
    ctx.fillStyle = PALETTE.trenchMudBone;
    ctx.fillRect(cx + 4, cl.y + cl.h - 5, cl.w - 8, 4);
  });
  ctx.restore();

  // 6. ANIMATED SEAGULLS (Rhythmic 2-Frame Flapping V-Wings across Open Sky)
  SEAGULLS.forEach((g) => {
    const progress = g.baseX + time * g.speed;
    const gx = Math.round((((progress % (width + 80)) + (width + 80)) % (width + 80)) - 40);
    const gy = Math.round(g.y + Math.sin(time * 2 + g.seed) * 3);
    const isFlapUp = Math.sin(time * g.flapRate + g.seed) > 0;

    ctx.save();
    ctx.translate(gx, gy);
    if (g.dir < 0) ctx.scale(-1, 1);

    // Body core in sandCream #DFCE91
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(-1, 0, 3, 2);
    // Head / beak
    ctx.fillRect(2, 0, 1, 1);

    // Flapping V-Wings in #DFCE91 with #A69C90 wingtips
    if (isFlapUp) {
      // Frame 1: Upward V-wings (\_/)
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(-2, -1, 1, 2);
      ctx.fillRect(1, -1, 1, 2);
      ctx.fillStyle = PALETTE.trenchMudBone; // Wingtips in #A69C90
      ctx.fillRect(-3, -3, 1, 2);
      ctx.fillRect(2, -3, 1, 2);
    } else {
      // Frame 2: Horizontal / Dipping Wings (- -)
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(-2, 0, 1, 1);
      ctx.fillRect(1, 0, 1, 1);
      ctx.fillStyle = PALETTE.trenchMudBone; // Wingtips in #A69C90
      ctx.fillRect(-4, 1, 2, 1);
      ctx.fillRect(2, 1, 2, 1);
    }

    ctx.restore();
  });

  // 7. OCCASIONAL DISTANT ROCKY & TROPICAL PIXEL ISLANDS ON HORIZON (Zero Trees!)
  drawDistantSeaIslands(ctx, width, horizonY);

  // 8. Distant Calm Ocean Seam & Waterline Shimmer
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(0, horizonY - 2, width, 3);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0, horizonY, width, 2);

  for (let x = 0; x < width; x += 16) {
    const glint = Math.sin(time * 3 + x * 0.12);
    if (glint > 0.45) {
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(x, horizonY - 1, 7, 1);
    }
  }

  ctx.restore();
}

/**
 * Draws occasional small distant rocky/tropical pixel islands with sandbars on the sea horizon
 * using strictly palette colors #7D6652 (earthBrown), #DFCE91 (sandCream), #72745C (oliveDrab),
 * #CAA574 (sandTan), #8DA082 (fieldSage), #423840 (bunkerCharcoal).
 */
function drawDistantSeaIslands(
  ctx: CanvasRenderingContext2D,
  width: number,
  baseY: number,
) {
  // Island 1 (Left sector, X ~ 210): Distant rocky island with sloping ridge & sand spit
  const i1X = 210;
  // Rocky knoll
  ctx.fillStyle = PALETTE.earthBrown; // #7D6652
  ctx.beginPath();
  ctx.moveTo(i1X - 32, baseY);
  ctx.lineTo(i1X - 16, baseY - 8);
  ctx.lineTo(i1X - 4, baseY - 12);
  ctx.lineTo(i1X + 8, baseY - 7);
  ctx.lineTo(i1X + 28, baseY);
  ctx.closePath();
  ctx.fill();

  // Shadow slope on the left
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(i1X - 22, baseY - 6, 12, 6);

  // Tropical vegetation crest in #72745C & #8DA082
  ctx.fillStyle = PALETTE.oliveDrab; // #72745C
  ctx.fillRect(i1X - 10, baseY - 13, 8, 3);
  ctx.fillRect(i1X - 6, baseY - 14, 4, 2);
  ctx.fillStyle = PALETTE.fieldSage;
  ctx.fillRect(i1X - 4, baseY - 13, 3, 2);

  // Sandy beach & sandbars extending into the sea in #DFCE91 & #CAA574
  ctx.fillStyle = PALETTE.sandTan;
  ctx.fillRect(i1X - 36, baseY - 2, 70, 3);
  ctx.fillStyle = PALETTE.sandCream; // #DFCE91
  ctx.fillRect(i1X - 40, baseY - 1, 78, 2);
  ctx.fillRect(i1X + 16, baseY - 2, 28, 2); // extended sandbar spit

  // Island 2 (Center sector, X ~ 670): Small low tropical atoll with sandbar
  const i2X = 670;
  ctx.fillStyle = PALETTE.earthBrown;
  ctx.fillRect(i2X - 18, baseY - 5, 36, 5);
  ctx.fillRect(i2X - 8, baseY - 8, 18, 4);

  // Lush scrub tufts
  ctx.fillStyle = PALETTE.oliveDrab;
  ctx.fillRect(i2X - 12, baseY - 9, 8, 3);
  ctx.fillRect(i2X + 2, baseY - 7, 7, 3);
  ctx.fillStyle = PALETTE.fieldSage;
  ctx.fillRect(i2X - 10, baseY - 10, 4, 2);

  // Long flat sandbar
  ctx.fillStyle = PALETTE.sandTan;
  ctx.fillRect(i2X - 26, baseY - 2, 54, 3);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(i2X - 30, baseY - 1, 62, 2);

  // Island 3 (Right sector, X ~ 1080): Distant volcanic knoll with sandy rim
  const i3X = 1080;
  ctx.fillStyle = PALETTE.earthBrown;
  ctx.beginPath();
  ctx.moveTo(i3X - 26, baseY);
  ctx.lineTo(i3X - 8, baseY - 11);
  ctx.lineTo(i3X + 4, baseY - 10);
  ctx.lineTo(i3X + 22, baseY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(i3X - 14, baseY - 7, 8, 7);

  // Green crest
  ctx.fillStyle = PALETTE.oliveDrab;
  ctx.fillRect(i3X - 10, baseY - 12, 12, 3);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(i3X - 30, baseY - 1, 58, 2);
}

/**
 * Draws independent world-space bullets and tracers fired by aircraft
 * with actual Canvas 2D radial gradient bloom.
 */
export function drawPlaneBullets(
  ctx: CanvasRenderingContext2D,
  bullets: PlaneBullet[],
) {
  bullets.forEach((b) => {
    ctx.save();
    const bx = Math.round(b.x);
    const by = Math.round(b.y);

    // Trail
    for (let i = 0; i < b.trail.length; i++) {
      const pt = b.trail[i];
      const a = (i / b.trail.length) * 0.7;
      ctx.fillStyle = PALETTE.sandCream;
      ctx.globalAlpha = a * 0.6;
      ctx.fillRect(Math.round(pt.x) - 1, Math.round(pt.y) - 1, 3, 3);
    }

    // ACTUAL RADIAL GRADIENT BLOOM ON PLANE BULLET (lighter blend)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloomR = 10;
    const bGrad = ctx.createRadialGradient(bx, by, 1, bx, by, bloomR);
    bGrad.addColorStop(0, 'rgba(255, 250, 200, 0.85)');
    bGrad.addColorStop(0.3, 'rgba(255, 200, 90, 0.45)');
    bGrad.addColorStop(0.7, 'rgba(220, 120, 40, 0.15)');
    bGrad.addColorStop(1, 'rgba(180, 80, 20, 0)');
    ctx.fillStyle = bGrad;
    ctx.beginPath();
    ctx.arc(bx, by, bloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Solid core
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(bx - 2, by - 1, 5, 2);

    ctx.restore();
  });
}

/**
 * Draws the WWII top-down battlefield terrain sharp and level with the troops
 * using actual ambient occlusion around craters and terrain revetments.
 */
/**
 * Renders the Open Ocean Maritime Environment for NAVY TEST.
 * Features dithered deep-navy ocean background with horizontally scrolling
 * 1-bit wave ticks and water foam to simulate dynamic open-sea swells.
 */
export function drawOpenOceanBattlefield(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  dynamicCraters?: GroundCrater[],
  bloodPuddles?: BloodPuddle[],
  casualtyRecords?: CasualtyRecord[],
) {
  // 1. Dynamic open sea skybox with distant islands & animated seagulls (Zero Trees!)
  drawSeaSkyboxAndHorizon(ctx, width, time);

  const horizonY = 114;

  // 2. Distant open ocean horizon seam (clean ocean horizon)
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(0, horizonY - 4, width, 5);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0, horizonY - 2, width, 3);
  ctx.fillStyle = PALETTE.sandCream;
  // Faint horizon glint
  for (let x = 0; x < width; x += 18) {
    const glint = Math.sin(time * 3 + x * 0.1);
    if (glint > 0.4) {
      ctx.fillRect(x, horizonY - 2, 8, 1);
    }
  }

  // 3. Deep Navy Ocean Floor Fill (Y: 114 to height)
  const oceanGrad = ctx.createLinearGradient(0, horizonY, 0, height);
  oceanGrad.addColorStop(0, PALETTE.navalSteel);
  oceanGrad.addColorStop(0.35, PALETTE.spruceSea);
  oceanGrad.addColorStop(0.7, PALETTE.bunkerCharcoal);
  oceanGrad.addColorStop(1, '#251e24'); // Deep bunker charcoal shadow
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  // 4. Horizontally scrolling 1-bit wave ticks and water foam swells
  for (let y = horizonY + 6; y < height; y += 10) {
    // Dynamic open-sea swells
    const swell = Math.sin(time * 2.1 + y * 0.045) * 10 + Math.cos(time * 1.4 + y * 0.02) * 6;
    const speed = 14 + ((y * 7) % 18);
    const scroll = (time * speed) % 44;

    // 1-bit Wave Ticks in Spruce Sea and Naval Steel
    ctx.fillStyle = (Math.floor(y / 10) % 2 === 0) ? PALETTE.spruceSea : PALETTE.navalSteel;
    for (let x = -50; x < width + 50; x += 38) {
      const wx = Math.round(x + scroll + swell);
      ctx.fillRect(wx, y, 14, 2);

      // 1-bit dither dots under wave tick
      if (((Math.floor(wx / 4) + Math.floor(y / 10)) % 2) === 0) {
        ctx.fillRect(wx + 2, y + 2, 2, 2);
        ctx.fillRect(wx + 8, y + 2, 2, 2);
      }
    }

    // Dynamic wave foam crests on occasional wave peaks
    if ((Math.floor(y / 10) % 3) === 0) {
      ctx.fillStyle = PALETTE.sandCream;
      for (let x = -30; x < width + 50; x += 64) {
        const fx = Math.round(x + scroll * 1.2 + swell);
        ctx.fillRect(fx + 3, y - 1, 8, 1);
        ctx.fillRect(fx + 5, y - 2, 4, 1);
      }
    }
  }

  // 5. Tactical Nautical Chart Grid Lines
  ctx.save();
  ctx.strokeStyle = PALETTE.deepTaupe;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 8]);
  for (let gx = 100; gx < width; gx += 110) {
    ctx.beginPath();
    ctx.moveTo(gx, horizonY);
    ctx.lineTo(gx, height);
    ctx.stroke();
  }
  for (let gy = 160; gy < height; gy += 95) {
    ctx.beginPath();
    ctx.moveTo(30, gy);
    ctx.lineTo(width - 30, gy);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // 6. Underwater Depth-Charge Churns & Ocean Impact Vortices (Dynamic Craters on Sea)
  if (dynamicCraters && dynamicCraters.length > 0) {
    dynamicCraters.forEach((dc) => {
      const alpha = dc.alpha !== undefined ? dc.alpha : 1.0;
      if (alpha <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

      // Expanding concentric churned water rings
      ctx.strokeStyle = PALETTE.sandCream;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(dc.x, dc.y, dc.rx + 4, dc.ry + 2, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = PALETTE.spruceSea;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(dc.x, dc.y, dc.rx, dc.ry, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Deep dark underwater vortex center
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.beginPath();
      ctx.ellipse(dc.x, dc.y, Math.max(2, dc.rx * 0.5), Math.max(1, dc.ry * 0.5), 0, 0, Math.PI * 2);
      ctx.fill();

      // Foam spray flecks
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(Math.round(dc.x - 3), Math.round(dc.y - 1), 3, 2);
      ctx.fillRect(Math.round(dc.x + 2), Math.round(dc.y), 2, 2);
      ctx.restore();
    });
  }

  // 7. Expanding Dark Oil Slicks & Floating Wooden Wreckage from Casualties
  if (casualtyRecords && casualtyRecords.length > 0) {
    casualtyRecords.forEach((rec) => {
      if (rec.fluidAlpha <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, rec.fluidAlpha));
      const fx = Math.round(rec.x);
      const fy = Math.round(rec.y + 4);

      // Expanding dark bunker charcoal oil slick on water
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.beginPath();
      ctx.ellipse(fx, fy, rec.fluidRx * 1.3, rec.fluidRy * 1.1, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.deepTaupe;
      ctx.beginPath();
      ctx.ellipse(fx, fy - 1, rec.fluidRx * 0.85, rec.fluidRy * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Iridescent oil sheen flecks
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(fx - 5, fy, 4, 1.5);
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(fx + 3, fy - 1, 3, 1);
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.fillRect(fx - 2, fy + 2, 3, 1);

      // Floating wooden crates & debris wreckage rocking in the swells
      const debrisBob = Math.sin(time * 3 + fx * 0.05) * 1.5;
      ctx.fillStyle = PALETTE.khakiLeather;
      ctx.fillRect(fx - 9, Math.round(fy - 3 + debrisBob), 5, 4);
      ctx.fillStyle = PALETTE.earthBrown;
      ctx.fillRect(fx - 9, Math.round(fy - 3 + debrisBob), 5, 1);
      ctx.fillRect(fx + 7, Math.round(fy - 2 - debrisBob), 6, 3);
      ctx.fillStyle = PALETTE.sandTan;
      ctx.fillRect(fx + 8, Math.round(fy - 1 - debrisBob), 4, 1);

      ctx.restore();
    });
  }

  // 8. Standalone oil puddles
  if (bloodPuddles && bloodPuddles.length > 0) {
    bloodPuddles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(Math.round(p.x - 3), Math.round(p.y), 3, 1.5);
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(Math.round(p.x + 2), Math.round(p.y - 1), 2, 1);
      ctx.restore();
    });
  }
}

export function drawWWIIBattlefield(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  theater: TheaterId,
  dynamicCraters?: GroundCrater[],
  bloodPuddles?: BloodPuddle[],
  casualtyRecords?: CasualtyRecord[],
) {
  // If theater is NAVY TEST or AIR STRIKE TEST: Render full open-sea maritime battleground
  if (theater === 'navy_test' || theater === 'air_strike_test') {
    drawOpenOceanBattlefield(ctx, width, height, time, dynamicCraters, bloodPuddles, casualtyRecords);
    return;
  }

  // 1. Render Skybox: Sea skybox with islands & seagulls for Pacific, or Treeline for land theaters
  if (theater === 'pacific') {
    drawSeaSkyboxAndHorizon(ctx, width, time);
  } else {
    drawSkyboxAndTreeline(ctx, width, time);
  }

  // 2. Base Terrain Fill based on Theater (Y: 114 to 530)
  let baseColor: string = PALETTE.oliveDrab;
  let secColor: string = PALETTE.fieldSage;
  let dirtColor: string = PALETTE.earthBrown;

  if (theater === 'eastern') {
    baseColor = PALETTE.feldgrau;
    secColor = PALETTE.trenchMudBone;
    dirtColor = PALETTE.deepTaupe;
  } else if (theater === 'north_africa') {
    baseColor = PALETTE.sandTan;
    secColor = PALETTE.sandCream;
    dirtColor = PALETTE.terracotta;
  } else if (theater === 'pacific') {
    baseColor = PALETTE.sandCream;
    secColor = PALETTE.fieldSage;
    dirtColor = PALETTE.sandTan;
  }

  // Draw ground layer (Y: 114 to 530)
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 114, width, 416);

  // Tactical terrain patches (mottled top-down camo / fields)
  ctx.fillStyle = secColor;
  for (let gx = 0; gx < width; gx += 64) {
    for (let gy = 120; gy < 520; gy += 48) {
      const hash = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
      const noise = hash - Math.floor(hash);
      if (noise > 0.55) {
        ctx.fillRect(gx + 4, gy + 4, 32, 20);
      }
    }
  }

  // Transversal supply road behind the frontline rank headers
  ctx.fillStyle = dirtColor;
  ctx.fillRect(0, 115, width, 6);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  for (let rx = 10; rx < width; rx += 24) {
    ctx.fillRect(rx, 116, 8, 4);
  }

  // Tactical Map Grid Coordinates
  ctx.strokeStyle = PALETTE.deepTaupe;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 8]);
  for (let gx = 100; gx < width; gx += 110) {
    ctx.beginPath();
    ctx.moveTo(gx, 90);
    ctx.lineTo(gx, 520);
    ctx.stroke();
  }
  for (let gy = 150; gy < 520; gy += 90) {
    ctx.beginPath();
    ctx.moveTo(40, gy);
    ctx.lineTo(width - 40, gy);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 3. Frontline Trenches & Fortifications
  drawTrenchLine(ctx, 470, 130, 390);
  drawTrenchLine(ctx, 810, 130, 390);

  // 4. Shell Craters across No-Man's Land (Pre-existing static craters with ambient occlusion)
  const craters = [
    {x: 520, y: 360, r: 16},
    {x: 760, y: 380, r: 14},
    {x: 640, y: 440, r: 20},
    {x: 580, y: 490, r: 12},
    {x: 700, y: 495, r: 15},
    {x: 490, y: 420, r: 10},
    {x: 790, y: 430, r: 11},
  ];
  craters.forEach((c) => {
    drawSingleCrater(ctx, c.x, c.y, c.r, c.r * 0.7, dirtColor);
  });

  // 4b. Draw Dynamic Combat Craters & Small Casualty Craters (layered UNDERNEATH fluids & units!)
  if (dynamicCraters && dynamicCraters.length > 0) {
    dynamicCraters.forEach((dc) => {
      const alpha = dc.alpha !== undefined ? dc.alpha : 1.0;
      if (alpha > 0.001) {
        drawSingleCrater(ctx, dc.x, dc.y, dc.rx, dc.ry, dirtColor, alpha);
      }
    });
  }

  // 4c. Draw Ground Blood & Engine Oil/Fuel Puddles from casualties (anchored to fixed ground coordinates)
  if (casualtyRecords && casualtyRecords.length > 0) {
    casualtyRecords.forEach((rec) => {
      if (rec.fluidAlpha <= 0.001) return;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, rec.fluidAlpha));
      const fx = Math.round(rec.x);
      const fy = Math.round(rec.y + 4);

      if (rec.fluidType === 'oil') {
        ctx.fillStyle = PALETTE.bunkerCharcoal;
        ctx.beginPath();
        ctx.ellipse(fx, fy, rec.fluidRx, rec.fluidRy, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = PALETTE.deepTaupe;
        ctx.beginPath();
        ctx.ellipse(fx, fy - 1, rec.fluidRx * 0.7, rec.fluidRy * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();

        // Subtle rainbow sheen flecks
        ctx.fillStyle = PALETTE.navalSteel;
        ctx.fillRect(fx - 3, fy, 3, 1.5);
        ctx.fillStyle = PALETTE.mustardBrass;
        ctx.fillRect(fx + 2, fy - 1, 2, 1);
      } else {
        ctx.fillStyle = PALETTE.crimson;
        ctx.beginPath();
        ctx.ellipse(fx, fy, rec.fluidRx, rec.fluidRy, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = PALETTE.plum;
        ctx.beginPath();
        ctx.ellipse(fx, fy, rec.fluidRx * 0.55, rec.fluidRy * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  // 4d. Draw Standalone Blood Puddles from impacts
  if (bloodPuddles && bloodPuddles.length > 0) {
    bloodPuddles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      if (p.type === 'oil') {
        ctx.fillStyle = PALETTE.bunkerCharcoal;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.deepTaupe;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - 1, p.rx * 0.7, p.ry * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.navalSteel;
        ctx.fillRect(Math.round(p.x - 3), Math.round(p.y), 3, 1.5);
        ctx.fillStyle = PALETTE.mustardBrass;
        ctx.fillRect(Math.round(p.x + 2), Math.round(p.y - 1), 2, 1);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.plum;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx * 0.55, p.ry * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  // 5. Barbed Wire Obstacles across No-Man's Land
  ctx.fillStyle = PALETTE.earthBrown;
  for (let wy = 350; wy <= 510; wy += 35) {
    ctx.fillRect(620, wy, 3, 5);
    ctx.fillRect(660, wy, 3, 5);
    ctx.strokeStyle = PALETTE.feldgrau;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(615, wy + 2);
    ctx.lineTo(665, wy + 4);
    ctx.moveTo(615, wy + 4);
    ctx.lineTo(665, wy + 2);
    ctx.stroke();
  }

  // 6. Sandbag Revetments along frontline edges
  drawSandbags(ctx, 455, 140, 18);
  drawSandbags(ctx, 455, 260, 18);
  drawSandbags(ctx, 455, 380, 18);
  drawSandbags(ctx, 815, 140, 18);
  drawSandbags(ctx, 815, 260, 18);
  drawSandbags(ctx, 815, 380, 18);
}

function drawSingleCrater(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  dirtColor: string,
  alpha = 1.0,
) {
  if (alpha <= 0.001) return;
  const isSmall = rx <= 6;
  const aoSpread = isSmall ? 3 : 8;
  const rimSpread = isSmall ? 1.5 : 3;

  ctx.save();
  if (alpha < 0.999) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  }

  // ACTUAL AMBIENT OCCLUSION: soft dark radial drop shadow / contact crease surrounding crater
  const aoGrad = ctx.createRadialGradient(cx, cy, rx * 0.5, cx, cy, rx + aoSpread);
  aoGrad.addColorStop(0, 'rgba(20, 16, 22, 0.65)');
  aoGrad.addColorStop(0.65, 'rgba(35, 28, 34, 0.28)');
  aoGrad.addColorStop(1, 'rgba(35, 28, 34, 0)');
  ctx.fillStyle = aoGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1, rx + aoSpread, ry + (isSmall ? 2 : 5), 0, 0, Math.PI * 2);
  ctx.fill();

  // Uplifted rim
  ctx.fillStyle = dirtColor;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx + rimSpread, ry + rimSpread * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  // Inner scorch ring
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Deep pit
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.beginPath();
  ctx.ellipse(cx - 0.5, cy - 0.5, Math.max(1, rx * 0.55), Math.max(1, ry * 0.5), 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawTrenchLine(ctx: CanvasRenderingContext2D, x: number, startY: number, height: number) {
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(x - 6, startY, 12, height);
  ctx.fillStyle = PALETTE.earthBrown;
  for (let ty = startY + 4; ty < startY + height; ty += 12) {
    ctx.fillRect(x - 4, ty, 8, 4);
  }
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(x - 6, startY, 2, height);
}

function drawSandbags(ctx: CanvasRenderingContext2D, x: number, y: number, count: number) {
  for (let i = 0; i < count; i++) {
    const sy = y + i * 8;
    ctx.fillStyle = PALETTE.sandTan;
    ctx.fillRect(x, sy, 7, 5);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(x + 1, sy + 1, 5, 2);
    ctx.fillStyle = PALETTE.earthBrown;
    ctx.fillRect(x, sy + 4, 7, 1);
  }
}

/**
 * Animated Coastal Sea at the edge of the troop lines (Y: 525 to 720)
 */
export function drawAnimatedSea(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
) {
  const seaTop = 525;

  ctx.fillStyle = PALETTE.sandTan;
  ctx.fillRect(0, seaTop, width, 14);

  const surfLapping = Math.sin(time * 2.2) * 4;
  ctx.fillStyle = PALETTE.khakiLeather;
  ctx.fillRect(0, seaTop + 8, width, 6);

  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(0, seaTop + 14, width, height - (seaTop + 14));

  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0, seaTop + 50, width, height - (seaTop + 50));

  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(0, seaTop + 130, width, height - (seaTop + 130));

  ctx.fillStyle = PALETTE.spruceSea;
  for (let y = seaTop + 24; y < height; y += 22) {
    const waveShift = Math.sin(time * 1.8 + y * 0.08) * 16;
    for (let x = -20; x < width + 40; x += 36) {
      ctx.fillRect(x + waveShift, y, 18, 3);
    }
  }

  ctx.fillStyle = PALETTE.sandCream;
  for (let y = seaTop + 34; y < height; y += 30) {
    const foamShift = Math.cos(time * 2.1 + y * 0.07) * 20;
    for (let x = 10; x < width + 40; x += 48) {
      ctx.fillRect(x + foamShift, y, 10, 2);
      ctx.fillRect(x + foamShift + 3, y - 1, 4, 1);
    }
  }

  ctx.fillStyle = PALETTE.sandCream;
  for (let x = 0; x < width; x += 12) {
    const waveEdge = Math.sin(time * 3 + x * 0.05) * 3 + surfLapping;
    ctx.fillRect(x, seaTop + 14 + waveEdge, 10, 3);
  }
}

// ============================================================================
// CLEAN RANK BADGES & PIXEL-ART ROMAN NUMERALS (I, II, III, IV)
// ============================================================================

export const ROMAN_PIXEL_BITMAPS: Record<string, number[][]> = {
  'I': [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 1],
  ],
  'II': [
    [1, 1, 0, 1, 1],
    [0, 1, 0, 0, 1],
    [0, 1, 0, 0, 1],
    [0, 1, 0, 0, 1],
    [1, 1, 0, 1, 1],
  ],
  'III': [
    [1, 1, 0, 1, 1, 0, 1, 1],
    [0, 1, 0, 0, 1, 0, 0, 1],
    [0, 1, 0, 0, 1, 0, 0, 1],
    [0, 1, 0, 0, 1, 0, 0, 1],
    [1, 1, 0, 1, 1, 0, 1, 1],
  ],
  'IV': [
    [1, 0, 0, 0, 1, 0, 1, 1, 1],
    [1, 0, 0, 0, 1, 0, 0, 1, 0],
    [0, 1, 0, 1, 0, 0, 0, 1, 0],
    [0, 1, 0, 1, 0, 0, 0, 1, 0],
    [0, 0, 1, 0, 0, 0, 1, 1, 1],
  ],
};

export function drawPixelRomanNumeral(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  startY: number,
  roman: 'I' | 'II' | 'III' | 'IV',
  color: string,
  shadowColor?: string,
  pixelSize = 2,
) {
  const bitmap = ROMAN_PIXEL_BITMAPS[roman];
  if (!bitmap) return;
  const h = bitmap.length;
  const w = bitmap[0].length;
  const totalW = w * pixelSize;
  const startX = Math.round(centerX - totalW / 2);

  if (shadowColor) {
    ctx.fillStyle = shadowColor;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (bitmap[r][c]) {
          ctx.fillRect(startX + c * pixelSize + 1, startY + r * pixelSize + 1, pixelSize, pixelSize);
        }
      }
    }
  }

  ctx.fillStyle = color;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (bitmap[r][c]) {
        ctx.fillRect(startX + c * pixelSize, startY + r * pixelSize, pixelSize, pixelSize);
      }
    }
  }
}

/**
 * Draws a simple, crisp pixel-art Roman numeral badge ("I", "II", "III", "IV")
 * positioned cleanly at the top of each rank column without any background dimming.
 */
export function drawPixelRankBadge(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  y: number,
  roman: 'I' | 'II' | 'III' | 'IV',
  isActive: boolean,
  side: 'attacker' | 'defender',
  alpha = 1.0,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  const badgeW = 44;
  const badgeH = 20;
  const bx = Math.round(centerX - badgeW / 2);
  const by = Math.round(y);

  // 1-bit drop shadow
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(bx + 1, by + 1, badgeW, badgeH);

  // Thematic background plate
  if (isActive) {
    ctx.fillStyle = side === 'attacker' ? PALETTE.crimson : PALETTE.spruceSea;
  } else {
    ctx.fillStyle = PALETTE.bunkerCharcoal;
  }
  ctx.fillRect(bx, by, badgeW, badgeH);

  // Bevel border
  ctx.strokeStyle = isActive ? PALETTE.sandCream : PALETTE.deepTaupe;
  ctx.lineWidth = isActive ? 1.5 : 1;
  ctx.strokeRect(bx, by, badgeW, badgeH);

  // Corner rivets for active state
  if (isActive) {
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(bx + 2, by + 2, 2, 2);
    ctx.fillRect(bx + badgeW - 4, by + 2, 2, 2);
    ctx.fillRect(bx + 2, by + badgeH - 4, 2, 2);
    ctx.fillRect(bx + badgeW - 4, by + badgeH - 4, 2, 2);
  }

  // Crisp Roman numeral in pixel art
  const numColor = isActive ? PALETTE.sandCream : PALETTE.sandTan;
  const shadowColor = PALETTE.bunkerCharcoal;
  drawPixelRomanNumeral(ctx, centerX, by + 5, roman, numColor, shadowColor, 2);

  ctx.restore();
}

/**
 * Draws a procedural combat unit facing East (if Attacker) or West (if Defender),
 * using actual ambient occlusion drop shadows underneath and radial gradient bloom on muzzle flashes.
 */
export function drawProceduralUnit(
  ctx: CanvasRenderingContext2D,
  unit: CombatUnit,
  x: number,
  y: number,
  scale: number,
  time: number,
  factionColor: string,
  badgeImg: HTMLImageElement | null | undefined,
  isInFlight = false,
  smokeAlpha = 1.0,
  theater?: TheaterId,
) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  const isAttacker = unit.side === 'attacker';
  if (!isAttacker) {
    ctx.scale(-1, 1);
  }

  const noPlaneShadow = theater === 'air_strike_test';
  const noFire = theater === 'air_strike_test';

  // If airborne (only actual air category planes, NEVER naval vessels or aircraft carriers!)
  if (isInFlight && unit.type !== 'carrier') {
    ctx.restore();
    return;
  }

  // 1. FREEZE CASUALTY MOVEMENT: ZERO BOBBING, ZERO SHUDDER, ZERO IDLE DRIFT
  // Static Cannons & Flak Guns (No Bobbing): Wheels, carriage, and mounts firmly anchored to ground
  const isCasualty = unit.status === 'downed' || unit.status === 'dead' || unit.isPendingCasualty;
  const isStaticMount = unit.type === 'artillery' || unit.type === 'aaa';
  const bob = (isCasualty || isStaticMount) ? 0 : Math.sin(time * 3 + unit.animBobOffset) * 1.5;
  let recoilX = 0;
  let recoilY = bob;

  if (!isCasualty) {
    const isHeavyMechanized = unit.type === 'tank' || unit.type === 'artillery';
    if (isHeavyMechanized && unit.animRecoil > 0) {
      const baseKick = -unit.animRecoil * 5.2;
      const shudder = Math.sin(unit.animRecoil * Math.PI * 7) * (unit.animRecoil * 2.2);
      recoilX = baseKick + shudder;
      recoilY = isStaticMount ? 0 : bob + Math.cos(unit.animRecoil * Math.PI * 5) * (unit.animRecoil * 1.4);
    } else if (unit.animRecoil > 0) {
      recoilX = -unit.animRecoil * 3.5;
      recoilY = isStaticMount ? 0 : bob;
    }
  }

  ctx.translate(Math.round(recoilX), Math.round(recoilY));

  // Apply hull listing angle (e.g. 10 deg listing if injured, 45 deg if sinking)
  if (unit.listingAngle) {
    ctx.rotate(unit.listingAngle);
  }

  if (unit.status === 'downed') {
    drawDownedUnit(ctx, unit, factionColor, time, smokeAlpha, noFire);
    ctx.restore();
    return;
  }

  if (unit.isDestroyed) {
    ctx.globalAlpha = 0.25;
  }

  switch (unit.type) {
    case 'infantry':
      drawInfantry(ctx, factionColor, unit, time);
      break;
    case 'artillery':
      drawArtillery(ctx, factionColor, unit, time);
      break;
    case 'tank':
      drawTank(ctx, factionColor, unit, time);
      break;
    case 'fighter':
      drawFighter(ctx, factionColor, unit, time, noPlaneShadow);
      break;
    case 'tactical_bomber':
      drawTacticalBomber(ctx, factionColor, unit, time, noPlaneShadow);
      break;
    case 'strategic_bomber':
      drawStrategicBomber(ctx, factionColor, unit, time, noPlaneShadow);
      break;
    case 'submarine':
      drawSubmarine(ctx, factionColor, unit, time);
      break;
    case 'destroyer':
      drawDestroyer(ctx, factionColor, unit, time);
      break;
    case 'cruiser':
      drawCruiser(ctx, factionColor, unit, time);
      break;
    case 'carrier':
      drawCarrier(ctx, factionColor, unit, time, noFire);
      break;
    case 'battleship':
      drawBattleship(ctx, factionColor, unit, time, noFire);
      break;
    case 'aaa':
      drawAaaFlak(ctx, factionColor, unit, time);
      break;
  }

  // ACTUAL RADIAL GRADIENT BLOOM ON MUZZLE FLASH
  if (unit.animRecoil > 0.25) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const muzzleBloomR = 18 * unit.animRecoil;
    const flashX = unit.type === 'tank' ? 29 : 18;
    const flashY = unit.type === 'tank' ? -9 : -2;
    const mGrad = ctx.createRadialGradient(flashX, flashY, 2, flashX, flashY, muzzleBloomR);
    mGrad.addColorStop(0, 'rgba(255, 250, 210, 0.95)');
    mGrad.addColorStop(0.3, 'rgba(255, 190, 70, 0.6)');
    mGrad.addColorStop(0.7, 'rgba(230, 100, 30, 0.2)');
    mGrad.addColorStop(1, 'rgba(180, 40, 10, 0)');
    ctx.fillStyle = mGrad;
    ctx.beginPath();
    ctx.arc(flashX, flashY, muzzleBloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Bright flash core
    ctx.fillStyle = PALETTE.sandCream;
    ctx.beginPath();
    ctx.arc(flashX, flashY, 4 * unit.animRecoil, 0, Math.PI * 2);
    ctx.fill();
  }

  // Smoking damage state
  if (unit.maxHp > 1 && unit.currentHp < unit.maxHp) {
    drawDamageSmoke(ctx, time);
  }

  // Synergy Badge
  if (unit.hasSynergyBonus) {
    ctx.save();
    if (!isAttacker) ctx.scale(-1, 1);
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.beginPath();
    ctx.arc(0, -22, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(-2, -24, 4, 4);
    ctx.restore();
  }

  ctx.restore();
}

function drawInfantry(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
) {
  // Ambient occlusion drop shadow
  drawAmbientOcclusionShadow(ctx, 0, 9, 10, 4, 11);

  if (unit.isCheering) {
    // VICTORY CELEBRATORY CHEERING ANIMATION
    const cheerBob = Math.abs(Math.sin(time * 9 + unit.animBobOffset)) * 4.5;
    ctx.translate(0, -cheerBob);

    // Boots
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-4, 4, 3, 5);
    ctx.fillRect(1, 4, 3, 5);

    // Trousers
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-4, 0, 8, 5);

    // Torso / Tunic
    ctx.fillStyle = factionColor;
    ctx.fillRect(-5, -7, 10, 8);

    // Leather web gear
    ctx.fillStyle = PALETTE.khakiLeather;
    ctx.fillRect(-5, -2, 10, 2);
    ctx.fillRect(-2, -7, 2, 5);

    // Left Arm: Raised high waving in triumph
    ctx.fillStyle = factionColor;
    ctx.fillRect(-8, -12, 3, 8);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(-8, -14, 3, 3); // hand

    // Right Arm & Raised Rifle: Held high skyward in celebratory cheer!
    ctx.save();
    ctx.translate(3, -6);
    ctx.rotate(-0.75); // tilted upward into the air
    ctx.fillStyle = factionColor;
    ctx.fillRect(0, -4, 4, 4);
    ctx.fillStyle = PALETTE.earthBrown;
    ctx.fillRect(2, -9, 3, 13);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(3, -17, 2, 9);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(3, -20, 2, 3); // bayonet glint
    ctx.restore();

    // Head tilted back cheering
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(-3, -12, 6, 5);
    // Mouth open in victory yell
    ctx.fillStyle = PALETTE.plum;
    ctx.fillRect(-1, -9, 3, 2);

    // Helmet
    ctx.fillStyle = factionColor;
    ctx.fillRect(-4, -15, 8, 4);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-5, -12, 10, 2);
    return;
  }

  // 1. OPENING DEPLOYMENT MARCHING ANIMATION: Walking gait bob & leg swinging
  if (unit.isMarching) {
    const marchBob = Math.abs(Math.sin(time * 11 + unit.animBobOffset)) * 2.5;
    ctx.translate(0, -marchBob);

    const legSwing = Math.sin(time * 11 + unit.animBobOffset) * 3.5;
    // Boots
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-4 + legSwing, 4, 3, 5);
    ctx.fillRect(1 - legSwing, 4, 3, 5);

    // Trousers
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-4, 0, 8, 5);

    // Torso / Tunic
    ctx.fillStyle = factionColor;
    ctx.fillRect(-5, -7, 10, 8);

    // Leather web gear
    ctx.fillStyle = PALETTE.khakiLeather;
    ctx.fillRect(-5, -2, 10, 2);
    ctx.fillRect(-2, -7, 2, 5);

    // Head & Skin
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(-3, -11, 6, 5);

    // Helmet Dome & Rim
    ctx.fillStyle = factionColor;
    ctx.fillRect(-4, -14, 8, 4);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-5, -11, 10, 2);

    // Rifle carried at slope on shoulder while marching
    ctx.save();
    ctx.translate(1, -6);
    ctx.rotate(-0.4);
    ctx.fillStyle = PALETTE.earthBrown;
    ctx.fillRect(-2, -2, 8, 3);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(6, -1, 7, 2);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(13, -2, 3, 1);
    ctx.restore();
    return;
  }

  // 2. POST-MARCH READY STATION ANIMATIONS
  if (unit.readyAnimProgress !== undefined && unit.readyAnimProgress >= 0) {
    const rp = unit.readyAnimProgress;
    if (unit.readyAnimType === 'crouch') {
      // Crouch down on knee and stand back up
      const crouchY = Math.sin(rp * Math.PI) * 4.5;
      ctx.translate(0, crouchY);

      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-4, 4, 4, 3);
      ctx.fillRect(1, 2, 3, 4);

      ctx.fillStyle = PALETTE.deepTaupe;
      ctx.fillRect(-4, 0, 8, 4);

      ctx.fillStyle = factionColor;
      ctx.fillRect(-5, -6, 10, 7);

      ctx.fillStyle = PALETTE.khakiLeather;
      ctx.fillRect(-5, -2, 10, 2);

      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(-3, -10, 6, 4);

      ctx.fillStyle = factionColor;
      ctx.fillRect(-4, -13, 8, 4);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-5, -10, 10, 2);

      ctx.fillStyle = PALETTE.earthBrown;
      ctx.fillRect(-1, -3, 8, 3);
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(7, -2, 7, 2);
      return;
    } else if (unit.readyAnimType === 'reload') {
      // Reload bolt action rifle: tilt rifle, cycle bolt back and forward
      const boltCycle = Math.sin(rp * Math.PI);
      const rifleTilt = -0.28 * boltCycle;

      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-4, 4, 3, 5);
      ctx.fillRect(1, 4, 3, 5);

      ctx.fillStyle = PALETTE.deepTaupe;
      ctx.fillRect(-4, 0, 8, 5);

      ctx.fillStyle = factionColor;
      ctx.fillRect(-5, -7, 10, 8);

      ctx.fillStyle = PALETTE.khakiLeather;
      ctx.fillRect(-5, -2, 10, 2);

      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(-3, -11, 6, 5);

      ctx.fillStyle = factionColor;
      ctx.fillRect(-4, -14, 8, 4);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-5, -11, 10, 2);

      ctx.save();
      ctx.rotate(rifleTilt);
      ctx.fillStyle = PALETTE.earthBrown;
      ctx.fillRect(-2, -4, 9, 3);
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(7, -3, 8, 2);
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(15, -4, 3, 1);
      if (boltCycle > 0.3) {
        ctx.fillStyle = PALETTE.mustardBrass;
        ctx.fillRect(0 - boltCycle * 2, -6, 2, 3);
      }
      ctx.restore();
      return;
    } else if (unit.readyAnimType === 'scan') {
      // Look up and scan the horizon with hand to brow
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-4, 4, 3, 5);
      ctx.fillRect(1, 4, 3, 5);

      ctx.fillStyle = PALETTE.deepTaupe;
      ctx.fillRect(-4, 0, 8, 5);

      ctx.fillStyle = factionColor;
      ctx.fillRect(-5, -7, 10, 8);

      ctx.fillStyle = PALETTE.khakiLeather;
      ctx.fillRect(-5, -2, 10, 2);

      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(-2, -12, 6, 5);

      ctx.fillStyle = factionColor;
      ctx.fillRect(-3, -15, 8, 4);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-4, -12, 10, 2);

      // Hand to brow
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(3, -13, 3, 2);

      ctx.fillStyle = PALETTE.earthBrown;
      ctx.fillRect(-2, -3, 8, 3);
      ctx.fillStyle = PALETTE.navalSteel;
      ctx.fillRect(6, -2, 7, 2);
      return;
    }
  }

  let aimOffset = 0;
  let stanceHunch = 0;
  if (unit.animAnticipation > 0) {
    aimOffset = -0.16;
    stanceHunch = Math.sin(time * 8) * 1.5;
    ctx.translate(0, stanceHunch);
  }

  // Boots
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-4, 4, 3, 5);
  ctx.fillRect(1, 4, 3, 5);

  // Trousers
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-4, 0, 8, 5);

  // Torso / Tunic
  ctx.fillStyle = factionColor;
  ctx.fillRect(-5, -7, 10, 8);

  // Leather web gear
  ctx.fillStyle = PALETTE.khakiLeather;
  ctx.fillRect(-5, -2, 10, 2);
  ctx.fillRect(-2, -7, 2, 5);

  // Head & Skin
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(-3, -11, 6, 5);

  // Helmet Dome & Rim
  ctx.fillStyle = factionColor;
  ctx.fillRect(-4, -14, 8, 4);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-5, -11, 10, 2);

  // Rifle & Bayonet
  ctx.save();
  if (aimOffset !== 0) {
    ctx.rotate(aimOffset);
  }
  ctx.fillStyle = PALETTE.earthBrown;
  ctx.fillRect(-2, -4, 9, 3);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(7, -3, 8, 2);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(15, -4, 3, 1);
  ctx.restore();
}

function drawArtillery(ctx: CanvasRenderingContext2D, factionColor: string, unit: CombatUnit, time = 0) {
  // Ambient occlusion drop shadow for cannon
  drawAmbientOcclusionShadow(ctx, 0, 9, 15, 5, 18);
  // Ambient occlusion drop shadow for crewman standing behind
  drawAmbientOcclusionShadow(ctx, -17, 8, 8, 3, 10);

  // Ready Station crank tilt
  let crankTilt = 0;
  if (unit.readyAnimProgress !== undefined && unit.readyAnimProgress >= 0) {
    crankTilt = Math.sin(unit.readyAnimProgress * Math.PI) * 0.18;
  }

  // --- ARTILLERY CREW SPRITE STANDING BEHIND CANNON ---
  // Crewman boots firmly planted on the ground (or walking if marching)
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  if (unit.isMarching) {
    const marchLeg = Math.sin(time * 11 + unit.animBobOffset) * 2;
    ctx.fillRect(-20 + marchLeg, 4, 3, 5);
    ctx.fillRect(-16 - marchLeg, 4, 3, 5);
  } else {
    ctx.fillRect(-20, 4, 3, 5);
    ctx.fillRect(-16, 4, 3, 5);
  }

  // Trousers
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-20, 0, 7, 5);

  // Torso / Tunic
  ctx.fillStyle = factionColor;
  ctx.fillRect(-21, -7, 9, 8);

  // Leather webbing & harness
  ctx.fillStyle = PALETTE.khakiLeather;
  ctx.fillRect(-21, -2, 9, 2);
  ctx.fillRect(-17, -7, 2, 5);

  // Crewman arms: manning gun trail / lanyard / breech (or crank)
  const crewLanyardPull = unit.animRecoil > 0 ? -3 : 0;
  ctx.fillStyle = factionColor;
  ctx.fillRect(-14 + crewLanyardPull, -4, 6, 3);
  ctx.fillStyle = PALETTE.sandCream; // hands on gun trail / lanyard
  ctx.fillRect(-9 + crewLanyardPull, -4, 2, 3);

  // Head & Skin
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(-19, -11, 5, 4);

  // Helmet Dome & Brim
  ctx.fillStyle = factionColor;
  ctx.fillRect(-20, -14, 7, 3.5);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-21, -11, 9, 1.5);

  // --- CANNON ASSEMBLY ---
  // Split Trail Carriage
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-13, 2, 15, 4);

  // Spoked Wheel
  ctx.save();
  ctx.translate(-2, 3);
  if (unit.isMarching) {
    ctx.rotate(time * 6);
  }
  ctx.strokeStyle = PALETTE.bunkerCharcoal;
  ctx.lineWidth = 2;
  ctx.fillStyle = PALETTE.earthBrown;
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wheel spokes
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-6, -1, 12, 2);
  ctx.fillRect(-1, -6, 2, 12);
  ctx.restore();

  // Hub
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-3, 2, 3, 3);

  // Gun Shield
  ctx.fillStyle = factionColor;
  ctx.fillRect(-3, -8, 5, 12);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(2, -7, 1, 10);

  // Barrel with elevation adjustment
  ctx.save();
  const tiltAngle = (unit.animAnticipation > 0 ? -0.42 : -0.18) - crankTilt;
  ctx.rotate(tiltAngle);
  const barrelRecoil = unit.animRecoil > 0 ? unit.animRecoil * 4 : 0;
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-4 - barrelRecoil, -5, 20, 4);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(14 - barrelRecoil, -6, 3, 6);
  ctx.restore();
}

function drawTank(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
) {
  const creepX = unit.animAnticipation > 0 ? 3 : 0;
  ctx.translate(creepX, 0);

  // Marching vibration
  if (unit.isMarching) {
    const marchVibe = Math.sin(time * 18 + unit.animBobOffset) * 0.6;
    ctx.translate(0, marchVibe);
  }

  // Ready station turret swivel
  let turretAngle = 0;
  if (unit.readyAnimProgress !== undefined && unit.readyAnimProgress >= 0) {
    turretAngle = Math.sin(unit.readyAnimProgress * Math.PI * 2) * 0.14;
  }

  // Scaled up by ~30% for heavy imposing battlefield presence
  // Ambient occlusion drop shadow
  drawAmbientOcclusionShadow(ctx, 0, 11, 26, 8, 34);

  // Caterpillar Treads (widened and heightened by ~1.3x)
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-18, 3, 36, 8);

  // Animated turning track treads if marching
  if (unit.isMarching) {
    ctx.fillStyle = PALETTE.deepTaupe;
    const trackTick = Math.floor((time * 24) % 6);
    for (let tx = -17 + trackTick; tx <= 16; tx += 6) {
      ctx.fillRect(tx, 3, 2, 8);
    }
  }

  // Road Wheels (5 heavy road wheels along track length)
  ctx.fillStyle = PALETTE.feldgrau;
  for (let i = -14; i <= 14; i += 7) {
    ctx.beginPath();
    ctx.arc(i, 7, 3.2, 0, Math.PI * 2);
    ctx.fill();
    if (unit.isMarching) {
      ctx.fillStyle = PALETTE.sandCream;
      const spinAngle = time * 14;
      ctx.fillRect(i + Math.cos(spinAngle) * 1.5, 7 + Math.sin(spinAngle) * 1.5, 1, 1);
      ctx.fillStyle = PALETTE.feldgrau;
    }
  }

  // Lower Hull
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-17, -1, 34, 6);

  // Upper Hull (sloped armor plate)
  ctx.fillStyle = factionColor;
  ctx.fillRect(-15, -6, 30, 6);
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-16, -2, 4, 3); // Glacis edge detail

  // Heavy Turret with swivel capability
  ctx.save();
  if (turretAngle !== 0) {
    ctx.translate(3, -9);
    ctx.rotate(turretAngle);
    ctx.translate(-3, 9);
  }

  ctx.fillStyle = factionColor;
  ctx.fillRect(-5, -13, 17, 8);
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(9, -12, 3, 6); // Gun mantlet armor plate
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-3, -16, 7, 3); // Commander's cupola hatch

  // Heavy Cannon barrel (~1.3x length and thickness)
  ctx.save();
  if (unit.animAnticipation > 0) {
    ctx.rotate(-0.08);
  }
  const barrelRecoil = unit.animRecoil > 0 ? unit.animRecoil * 4.2 : 0;
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(10 - barrelRecoil, -10, 18, 4);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(27 - barrelRecoil, -11, 4, 6); // Imposing muzzle brake
  ctx.restore();

  ctx.restore(); // restore turret swivel

  // Exhaust
  const exhaustLife = (time * (unit.isMarching ? 7 : 4)) % 1;
  ctx.fillStyle = PALETTE.trenchMudBone;
  ctx.fillRect(-18 - exhaustLife * 7, -3, unit.isMarching ? 4 : 3, unit.isMarching ? 4 : 3);
}

function drawFighter(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  noDropShadow = false,
) {
  // Ambient occlusion drop shadow (omitted if noDropShadow)
  if (!noDropShadow) {
    drawAmbientOcclusionShadow(ctx, 0, 18, 16, 5, 14);
  }

  const revSpeed = (unit.animAnticipation > 0 || unit.isMarching) ? 80 : 40;
  const jitter = unit.animAnticipation > 0 ? (Math.random() - 0.5) * 1.5 : 0;
  const alt = (unit.isMarching ? -10 : -6) + Math.sin(time * 4) * 2 + jitter;
  ctx.translate(0, alt);

  // Wings
  ctx.fillStyle = factionColor;
  ctx.fillRect(-6, -2, 14, 5);
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-8, 3, 16, 2);

  // Fuselage
  ctx.fillStyle = factionColor;
  ctx.fillRect(-12, -4, 22, 6);

  // Nose Cowl
  ctx.fillStyle = PALETTE.mustardBrass;
  ctx.fillRect(10, -3, 3, 4);

  // Tail Fin
  ctx.fillStyle = factionColor;
  ctx.fillRect(-12, -9, 4, 6);

  // Canopy
  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(-2, -6, 6, 3);

  // Propeller Blur
  ctx.fillStyle = PALETTE.sandCream;
  const propAngle = time * revSpeed;
  ctx.save();
  ctx.translate(13, -1);
  ctx.rotate(propAngle);
  ctx.fillRect(-1, -8, 2, 16);
  ctx.restore();
}

function drawTacticalBomber(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  noDropShadow = false,
) {
  // Ambient occlusion drop shadow (omitted if noDropShadow)
  if (!noDropShadow) {
    drawAmbientOcclusionShadow(ctx, 0, 20, 20, 6, 18);
  }

  const revSpeed = (unit.animAnticipation > 0 || unit.isMarching) ? 70 : 35;
  const jitter = unit.animAnticipation > 0 ? (Math.random() - 0.5) * 1.5 : 0;
  const alt = (unit.isMarching ? -12 : -8) + Math.sin(time * 3 + 1) * 2 + jitter;
  ctx.translate(0, alt);

  ctx.fillStyle = factionColor;
  ctx.fillRect(-8, -4, 18, 7);
  ctx.fillRect(-16, -5, 28, 8);

  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0, -9, 8, 4);
  ctx.fillRect(0, 3, 8, 4);

  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(8, -12, 1, 10);
  ctx.fillRect(8, 0, 1, 10);

  ctx.fillStyle = factionColor;
  ctx.fillRect(-16, -10, 4, 6);
  ctx.fillRect(-16, 3, 4, 6);

  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(10, -4, 4, 6);

  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-2, 3, 8, 3);
}

function drawStrategicBomber(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  noDropShadow = false,
) {
  // Ambient occlusion drop shadow (omitted if noDropShadow)
  if (!noDropShadow) {
    drawAmbientOcclusionShadow(ctx, 0, 22, 26, 7, 24);
  }

  const jitter = unit.animAnticipation > 0 ? (Math.random() - 0.5) * 1.5 : 0;
  const alt = (unit.isMarching ? -14 : -10) + Math.sin(time * 2.5) * 2 + jitter;
  ctx.translate(0, alt);

  ctx.fillStyle = factionColor;
  ctx.fillRect(-10, -6, 24, 10);
  ctx.fillRect(-22, -6, 40, 10);

  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-2, -14, 8, 4);
  ctx.fillRect(4, -10, 8, 4);
  ctx.fillRect(4, 5, 8, 4);
  ctx.fillRect(-2, 9, 8, 4);

  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(14, -5, 5, 5);

  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-22, -3, 3, 3);
  ctx.fillRect(2, -9, 4, 3);
}

function drawSubmarine(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
) {
  // Ambient occlusion and submerged hull shadow
  drawAmbientOcclusionShadow(ctx, 0, 5, 26, 6, 22);

  // Submerged dark hull shadow underwater in bunker charcoal / spruce sea
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.beginPath();
  ctx.ellipse(0, 4, 25, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Waterline hull (slate / faction color)
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-22, 3);
  ctx.lineTo(24, 3);
  ctx.lineTo(22, 0);
  ctx.lineTo(-20, 0);
  ctx.closePath();
  ctx.fill();

  // Low-profile Conning Tower
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-4, -6, 12, 7);
  ctx.fillStyle = factionColor;
  ctx.fillRect(-2, -5, 8, 5);

  // Periscope shears & searchlight
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(1, -12, 2, 7);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(1, -12, 3, 2); // Periscope lens glint

  // Foredeck deck gun
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(9, -2, 4, 2);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(11, -3, 6, 1.5);

  // Bow torpedo tube shutter caps
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(22, 1, 2, 2);

  // Bow wave and churning water wake ripples
  ctx.fillStyle = PALETTE.sandCream;
  const wakeW = Math.sin(time * 3) * 2;
  ctx.fillRect(23, 3, 6 + wakeW, 1.5);
  ctx.fillRect(-26, 3, 8, 1.5);
  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(-24, 4, 18, 1.5);

  // Torpedo launch bubbles on fire
  if (unit.animRecoil > 0) {
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(26, 0, 4, 3);
    ctx.fillRect(30, 1, 3, 2);
  }
}

function drawDestroyer(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
) {
  // Ambient occlusion drop shadow under hull
  drawAmbientOcclusionShadow(ctx, 0, 7, 28, 6, 24);

  // Red Boot-topping waterline bottom
  ctx.fillStyle = PALETTE.crimson;
  ctx.fillRect(-22, 5, 48, 2);

  // Sleek raked clipper bow & main hull
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-24, 5);
  ctx.lineTo(24, 5);
  ctx.lineTo(28, 0); // clipper bow
  ctx.lineTo(16, -2); // forecastle
  ctx.lineTo(-24, -2);
  ctx.closePath();
  ctx.fill();

  // Dark armor belt strip
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-23, 3, 49, 1.5);

  // Superstructure: Enclosed Bridge & Flying Bridge
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-6, -9, 14, 8);
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.fillRect(-4, -13, 10, 5);
  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(-3, -11, 7, 2); // Bridge observation slits

  // Rangefinder director & tripod mast
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(1, -19, 2, 7);
  ctx.fillRect(-2, -18, 8, 1.5);

  // Funnels (with black smoke caps)
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-12, -10, 5, 8);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-12, -11, 5, 2);

  // Midships Torpedo Tube Bank
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-5, -2, 8, 3);

  // Stern Depth Charge Racks
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-24, -3, 3, 3);

  // Water wake along hull
  ctx.fillStyle = PALETTE.sandCream;
  const bowFoam = Math.sin(time * 3.5) * 2;
  ctx.fillRect(26, 4, 7 + bowFoam, 2);
  ctx.fillRect(-27, 4, 6, 2);

  // Gun Turrets: Forward Turret (x = 14, y = -4) and Aft Turret (x = -17, y = -4)
  const isFiring = unit.animRecoil > 0;
  const turretAngle = isFiring ? -0.26 : 0;
  const barrelRecoil = isFiring ? unit.animRecoil * 3.5 : 0;

  // Forward Turret
  drawNavalTurret(ctx, 14, -4, turretAngle, barrelRecoil, 10, isFiring, unit.animRecoil);
  // Aft Turret
  drawNavalTurret(ctx, -17, -4, isFiring ? -0.15 : 0, isFiring ? barrelRecoil * 0.7 : 0, 9, false, 0);
}

function drawCruiser(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
) {
  // Ambient occlusion drop shadow under hull
  drawAmbientOcclusionShadow(ctx, 0, 8, 34, 7, 30);

  // Red Boot-topping waterline bottom
  ctx.fillStyle = PALETTE.crimson;
  ctx.fillRect(-28, 6, 60, 2);

  // Heavy cruiser armored hull
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-30, 6);
  ctx.lineTo(30, 6);
  ctx.lineTo(34, 0); // bow prow
  ctx.lineTo(20, -3); // forecastle
  ctx.lineTo(-30, -3);
  ctx.closePath();
  ctx.fill();

  // Dark armor belt
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-29, 3, 61, 2);

  // Multi-tier Superstructure Citadel
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-9, -12, 18, 9);
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.fillRect(-6, -17, 13, 6);
  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(-4, -15, 9, 2); // Bridge observation slits

  // Rangefinder Director & Fire Control Tower
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(0, -24, 3, 8);
  ctx.fillRect(-4, -23, 11, 2);

  // Twin Funnels with smoke caps
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-17, -13, 6, 10);
  ctx.fillRect(-8, -13, 5, 10);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-17, -14, 6, 2);
  ctx.fillRect(-8, -14, 5, 2);

  // Aircraft Catapult on quarterdeck
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-23, -6, 5, 3);

  // Bow wave and hull wake
  ctx.fillStyle = PALETTE.sandCream;
  const bowFoam = Math.sin(time * 3.5) * 3;
  ctx.fillRect(32, 5, 8 + bowFoam, 2);
  ctx.fillRect(-33, 5, 7, 2);

  // Turrets:
  // Turret A (Forward, x = 20, y = -5)
  // Turret B (Superfiring forward, x = 8, y = -9)
  // Turret C (Aft, x = -21, y = -5)
  const isFiring = unit.animRecoil > 0;
  const turretAngle = isFiring ? -0.24 : 0;
  const barrelRecoil = isFiring ? unit.animRecoil * 4.2 : 0;

  drawNavalTurret(ctx, 20, -5, turretAngle, barrelRecoil, 12, isFiring, unit.animRecoil);
  drawNavalTurret(ctx, 8, -9, turretAngle, barrelRecoil, 12, isFiring, unit.animRecoil);
  drawNavalTurret(ctx, -21, -5, isFiring ? -0.12 : 0, isFiring ? barrelRecoil * 0.6 : 0, 11, false, 0);
}

function drawCarrier(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  noFire = false,
) {
  // Ambient occlusion drop shadow under hull
  drawAmbientOcclusionShadow(ctx, 0, 8, 38, 7, 34);

  // Red boot-topping bottom
  ctx.fillStyle = PALETTE.crimson;
  ctx.fillRect(-34, 6, 70, 2);

  // Lower hull
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-34, 6);
  ctx.lineTo(34, 6);
  ctx.lineTo(37, -1);
  ctx.lineTo(-34, -1);
  ctx.closePath();
  ctx.fill();

  // Dark armor belt
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-34, 3, 70, 2);

  // Secondary 5-inch deck gun & flak sponsor casemates along hull
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-22, 0, 5, 3);
  ctx.fillRect(20, 0, 5, 3);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-20, -1, 4, 1.5);
  ctx.fillRect(22, -1, 4, 1.5);

  // FLAT FLIGHT DECK (long teak wood flight deck with runway lines)
  ctx.fillStyle = PALETTE.khakiLeather;
  ctx.fillRect(-36, -6, 74, 5);

  // Teak planking lines & runway centerline dashes
  ctx.fillStyle = PALETTE.sandCream;
  for (let i = -30; i < 32; i += 8) {
    ctx.fillRect(i, -5, 5, 1);
  }

  // White arresting wires across aft flight deck
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(-26, -6, 1, 5);
  ctx.fillRect(-20, -6, 1, 5);
  ctx.fillRect(-14, -6, 1, 5);

  // Starboard Island Superstructure Bridge Tower & Radar
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(4, -15, 10, 10);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(6, -14, 7, 6);
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.fillRect(8, -19, 2, 5); // Radar mast
  ctx.fillRect(5, -18, 8, 1.5);

  // Chimney / Funnel venting off island side
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(1, -12, 3, 7);

  // --- CARRIER PLANE CAPACITY & AIRPLANE SYMBOLS ---
  // Count active planes carried (default max 2)
  const maxPlanes = unit.maxPlanesCarried !== undefined ? unit.maxPlanesCarried : 2;
  const planesCount = unit.planesCarried !== undefined ? unit.planesCarried : maxPlanes;

  // Render miniature pixel-art airplane icons cleanly on / beside the island status
  const iconBaseX = -32;
  const iconBaseY = -16;

  // Thematic tactical mini badge plate for plane count
  ctx.fillStyle = 'rgba(35, 28, 34, 0.85)';
  ctx.fillRect(iconBaseX - 3, iconBaseY - 3, maxPlanes * 11 + 5, 9);
  ctx.strokeStyle = PALETTE.deepTaupe;
  ctx.lineWidth = 1;
  ctx.strokeRect(iconBaseX - 3, iconBaseY - 3, maxPlanes * 11 + 5, 9);

  for (let p = 0; p < maxPlanes; p++) {
    const ix = iconBaseX + p * 11;
    const iy = iconBaseY;
    const isCarried = p < planesCount;
    drawMiniAirplaneIcon(ctx, ix, iy, isCarried);
  }

  // --- CARRIER LOGISTICS: PARKED FIGHTER PLANES ON FLIGHT DECK ---
  // Parked planes rest physically on the flight deck when onboard!
  for (let p = 0; p < Math.min(2, planesCount); p++) {
    const px = p === 0 ? -6 : 18;
    const py = -8;
    drawParkedCarrierFighter(ctx, px, py, time, p);
  }

  // Bow wave and hull wake
  ctx.fillStyle = PALETTE.sandCream;
  const bowFoam = Math.sin(time * 3) * 2;
  ctx.fillRect(36, 5, 8 + bowFoam, 2);
  ctx.fillRect(-37, 5, 6, 2);

  // Water wake when floating back astern
  if (unit.carrierFloatState === 'FLOATING_BACK') {
    ctx.fillStyle = PALETTE.sandCream;
    const wakePulse = (time * 4) % 1;
    ctx.fillRect(-44 - wakePulse * 6, 5, 8, 1.5);
    ctx.fillRect(35 + wakePulse * 4, 6, 6, 1.5);
    ctx.fillStyle = PALETTE.spruceSea;
    ctx.fillRect(-48, 6, 12, 1.5);
  }

  // Injured listing state (1st Hit)
  if (unit.maxHp > 1 && unit.currentHp === 1) {
    // Continuous rising dithered black smoke & flame plume (smoke only if noFire)
    drawShipDamageFireSmoke(ctx, time, -12, -8, noFire);
  }
}

/**
 * Draws miniature 6x5 pixel-art airplane silhouette for carrier capacity tracking.
 * Active plane: #DFCE91 (sandCream) with #495462 (navalSteel) tail & #A1A258 tip.
 * Launched plane: darkened silhouette #5E4E54 / #423840.
 */
function drawMiniAirplaneIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  isActive: boolean,
) {
  ctx.save();
  ctx.translate(x, y);

  if (isActive) {
    // 6x5 tiny fighter silhouette using palette colors #DFCE91 / #495462
    // Fuselage
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(0, 1, 6, 2);
    // Wings
    ctx.fillRect(2, -1, 2, 6);
    // Tail fin
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(0, 0, 1, 4);
    // Propeller tip
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(6, 1, 1, 2);
  } else {
    // Dimmed/dark silhouette when plane is launched/airborne
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(1, 1, 4, 2);
    ctx.fillRect(2, 0, 2, 4);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(2, 1, 2, 2);
  }

  ctx.restore();
}

function drawParkedCarrierFighter(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  time: number,
  index: number,
) {
  ctx.save();
  ctx.translate(px, py);

  // Tiny parked fighter sprite (facing forward east)
  // Shadow on flight deck
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-4, 2, 8, 2);

  // Wings (folded slightly or flat)
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-3, -1, 6, 4);

  // Fuselage
  ctx.fillStyle = PALETTE.fieldSage;
  ctx.fillRect(-5, 0, 11, 2.5);

  // Tail
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-5, -2, 2, 3);

  // Propeller spinner (yellow)
  ctx.fillStyle = PALETTE.mustardBrass;
  ctx.fillRect(6, 0.5, 2, 1.5);

  ctx.restore();
}

function drawBattleship(
  ctx: CanvasRenderingContext2D,
  factionColor: string,
  unit: CombatUnit,
  time: number,
  noFire = false,
) {
  // Massive broadside capital ship (~88px long)
  // Ambient occlusion drop shadow under massive hull
  drawAmbientOcclusionShadow(ctx, 0, 10, 44, 8, 40);

  // Red Antifouling Boot-topping bottom
  ctx.fillStyle = PALETTE.crimson;
  ctx.fillRect(-40, 7, 82, 3);

  // Massive Armored Dreadnought Hull
  ctx.fillStyle = factionColor;
  ctx.beginPath();
  ctx.moveTo(-42, 7);
  ctx.lineTo(40, 7);
  ctx.lineTo(46, 0); // clipper bow prow
  ctx.lineTo(26, -4); // raised forecastle
  ctx.lineTo(-42, -4);
  ctx.closePath();
  ctx.fill();

  // Heavy Charcoal Armor Belt Strip
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-41, 4, 82, 3);

  // Armored Citadel & Bridge Superstructure
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-15, -14, 28, 10);
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.fillRect(-10, -20, 20, 7);
  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(-8, -17, 16, 2.5); // Bridge armored slits

  // Tripod Mast & Rangefinder Directors
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-1, -29, 3, 10);
  ctx.fillRect(-6, -28, 13, 2);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(-4, -26, 9, 1);

  // Twin Heavy Funnels with smoke caps
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-24, -16, 8, 12);
  ctx.fillRect(-15, -16, 7, 12);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-24, -17, 8, 2);
  ctx.fillRect(-15, -17, 7, 2);

  // Secondary 5-inch Casemate Battery Ports
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-8, -2, 4, 2);
  ctx.fillRect(4, -2, 4, 2);

  // Bow wave and churning broadside wake
  ctx.fillStyle = PALETTE.sandCream;
  const bowFoam = Math.sin(time * 3.5) * 3;
  ctx.fillRect(43, 6, 11 + bowFoam, 3);
  ctx.fillRect(-46, 6, 9, 2);

  // HEAVY MAIN BATTERY TRIPLE TURRETS
  // Turret A (Forward, x = 24, y = -6)
  // Turret B (Superfiring Forward, x = 10, y = -11)
  // Turret C (Aft, x = -28, y = -6)
  const isFiring = unit.animRecoil > 0;
  const turretAngle = isFiring ? -0.28 : 0;
  const barrelRecoil = isFiring ? unit.animRecoil * 5.2 : 0;

  drawNavalTurret(ctx, 24, -6, turretAngle, barrelRecoil, 15, isFiring, unit.animRecoil, true);
  drawNavalTurret(ctx, 10, -11, turretAngle, barrelRecoil, 15, isFiring, unit.animRecoil, true);
  drawNavalTurret(ctx, -28, -6, isFiring ? -0.15 : 0, isFiring ? barrelRecoil * 0.7 : 0, 14, false, 0, true);

  // 1st Hit (Injured Phase):
  // Permanently tilted 10 degrees, continuous rising dithered black smoke (no fire if in AIR STRIKE TEST)!
  if (unit.maxHp > 1 && unit.currentHp === 1) {
    drawShipDamageFireSmoke(ctx, time, -4, -12, noFire);
  }
}

/**
 * Procedural Gun Turret with physical rotation toward target,
 * recoiling barrels, and massive yellow/white muzzle circles.
 */
function drawNavalTurret(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  angle: number,
  recoil: number,
  barrelLen: number,
  showMuzzleFlash: boolean,
  recoilVal = 0,
  isHeavyBattleship = false,
) {
  ctx.save();
  ctx.translate(tx, ty);

  // Barbette ring
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-7, 1, 14, 3);

  // Turret House (armored gunhouse)
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.beginPath();
  ctx.moveTo(-9, 2);
  ctx.lineTo(8, 2);
  ctx.lineTo(10, -3);
  ctx.lineTo(-8, -3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-7, -2, 14, 4);

  // Rotating Barrels
  ctx.save();
  ctx.translate(5, -1);
  ctx.rotate(angle);

  const barrelRecoil = recoil;
  const bHeight = isHeavyBattleship ? 2.5 : 2;

  // Dual or Triple Barrels
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0 - barrelRecoil, -2, barrelLen, bHeight);
  ctx.fillRect(0 - barrelRecoil, 1, barrelLen, bHeight);
  if (isHeavyBattleship) {
    ctx.fillRect(0 - barrelRecoil, -0.5, barrelLen + 1, bHeight);
  }

  // Massive Muzzle Flash Circles on Firing
  if (showMuzzleFlash && recoilVal > 0.15) {
    const mx = barrelLen - barrelRecoil;
    const my = 0;

    // Actual Canvas 2D Radial Gradient Bloom
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloomR = (isHeavyBattleship ? 26 : 18) * recoilVal;
    const mGrad = ctx.createRadialGradient(mx, my, 2, mx, my, bloomR);
    mGrad.addColorStop(0, 'rgba(255, 250, 200, 0.95)');
    mGrad.addColorStop(0.3, 'rgba(255, 190, 70, 0.65)');
    mGrad.addColorStop(0.7, 'rgba(220, 100, 30, 0.2)');
    mGrad.addColorStop(1, 'rgba(180, 40, 10, 0)');
    ctx.fillStyle = mGrad;
    ctx.beginPath();
    ctx.arc(mx, my, bloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Hot Core White/Yellow Flash Circle
    ctx.fillStyle = PALETTE.sandCream;
    ctx.beginPath();
    ctx.arc(mx, my, (isHeavyBattleship ? 7 : 5) * recoilVal, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.restore();
}

/**
 * Continuous rising dithered black smoke & flame plume for injured ships (1st Hit)
 */
function drawShipDamageFireSmoke(
  ctx: CanvasRenderingContext2D,
  time: number,
  baseX: number,
  baseY: number,
  noFire = false,
) {
  // Flickering Fire at the breach point (omitted if noFire)
  if (!noFire) {
    const flamePulse = Math.sin(time * 14) * 2;
    ctx.fillStyle = PALETTE.crimson;
    ctx.fillRect(baseX - 3, baseY - 4 - flamePulse, 7, 5 + flamePulse);
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(baseX - 1, baseY - 3 - flamePulse * 0.7, 4, 3 + flamePulse * 0.7);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(baseX, baseY - 2 - flamePulse * 0.5, 2, 2);
  }

  // Continuous Rising Dithered Black Smoke Plume
  for (let s = 0; s < 5; s++) {
    const phase = (time * 1.8 + s * 0.22) % 1;
    const sx = baseX - 2 + Math.sin(phase * 4) * 4 + phase * 6;
    const sy = baseY - 6 - phase * 26;
    const r = 3 + phase * 7;

    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - phase * 0.8);
    ctx.fillStyle = phase > 0.4 ? PALETTE.deepTaupe : PALETTE.bunkerCharcoal;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();

    // 1-bit dither flecks around smoke edge
    if (phase > 0.25) {
      ctx.fillStyle = PALETTE.trenchMudBone;
      ctx.fillRect(Math.round(sx + r * 0.6), Math.round(sy - 2), 2, 2);
      ctx.fillRect(Math.round(sx - r * 0.5), Math.round(sy - 3), 2, 2);
    }
    ctx.restore();
  }
}

/**
 * Draws the massive offshore support BATTLESHIP for European Test (Coast / Forest).
 * Sits down in the lower sea lane on attacker's left edge, roughly 2-3 ranks wide (~220px long).
 * Multi-tier grey/slate hull (#495462, #857577, #A69C90), armored barbettes, multiple rotating
 * gun turrets with recoiling long barrels, bridge superstructure, radar mast, and water wake.
 */
export function drawOffshoreBattleship(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  recoilX: number,
  recoilTrauma: number,
  turretAngle: number,
  turretRecoil: number,
  muzzleFlash: number,
  time: number,
) {
  ctx.save();
  ctx.translate(Math.round(x + recoilX), Math.round(y));

  // 1. Water Wake & Foam along the hull
  ctx.save();
  const wakeBob = Math.sin(time * 2.4) * 1.5;
  ctx.translate(0, wakeBob);

  // Forward bow wave & waterline foam
  ctx.fillStyle = PALETTE.sandCream;
  const foamAlpha = 0.5 + Math.sin(time * 4) * 0.2;
  ctx.globalAlpha = foamAlpha;
  ctx.fillRect(85, 16, 28, 3);
  ctx.fillRect(100, 14, 18, 2);
  ctx.fillRect(115, 18, 14, 2);

  // Waterline wash
  ctx.fillStyle = PALETTE.spruceSea;
  ctx.fillRect(-120, 18, 230, 4);
  ctx.fillStyle = PALETTE.sandCream;
  ctx.fillRect(-110, 19, 210, 2);
  ctx.restore();

  // 2. Ambient occlusion contact shadow under hull
  drawAmbientOcclusionShadow(ctx, 0, 18, 110, 8, 180);

  // 3. Lower Hull & Red Antifouling Boot-Topping Waterline
  ctx.fillStyle = PALETTE.crimson;
  ctx.beginPath();
  ctx.moveTo(-120, 18);
  ctx.lineTo(105, 18);
  ctx.lineTo(126, 14); // clipper bow prow
  ctx.lineTo(-120, 14);
  ctx.closePath();
  ctx.fill();

  // Dark armor belt strip
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-120, 11, 230, 3);

  // Main Hull (slate blue naval steel #495462)
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.beginPath();
  ctx.moveTo(-120, 11);
  ctx.lineTo(105, 11);
  ctx.lineTo(128, 5); // sloping bow
  ctx.lineTo(135, -2); // prow beak
  ctx.lineTo(100, -2); // forecastle deck
  ctx.lineTo(-120, -2); // quarterdeck
  ctx.closePath();
  ctx.fill();

  // Forecastle and Quarterdeck armor plating highlight (#857577)
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.fillRect(-115, -4, 215, 2);
  ctx.fillStyle = PALETTE.trenchMudBone;
  ctx.fillRect(-60, -5, 150, 1); // teak deck planking line

  // Prow anchor hawsehole & jackstaff
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(116, 2, 4, 3);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(128, -8, 2, 7);

  // 4. Superstructure Bridge Island & Tower
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-35, -18, 42, 14);
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.fillRect(-30, -24, 32, 7);
  // Armored Conning Tower
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-12, -28, 18, 5);
  ctx.fillStyle = PALETTE.spruceSea; // bridge observation slits
  ctx.fillRect(-10, -26, 14, 2);

  // Radar Mast & Rangefinder
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-5, -38, 3, 11);
  ctx.fillRect(-10, -36, 13, 2);
  ctx.fillStyle = PALETTE.trenchMudBone;
  ctx.fillRect(-8, -34, 9, 1);

  // Heavy Funnel / Smoke Stack
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-38, -26, 12, 10);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-38, -27, 12, 2);

  // Boiler exhaust vapor from funnel
  ctx.fillStyle = PALETTE.trenchMudBone;
  const steamP = (time * 3) % 1;
  ctx.globalAlpha = 0.5 * (1 - steamP);
  ctx.beginPath();
  ctx.arc(-32, -30 - steamP * 12, 2 + steamP * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // 5. Armored Main Battery Turrets
  // Turret 1 (Forward Turret A, x = 65, y = -3)
  drawSuperTurret(ctx, 65, -3, turretAngle, turretRecoil);
  // Turret 2 (Superfiring Turret B, x = 25, y = -8)
  drawSuperTurret(ctx, 25, -8, turretAngle, turretRecoil);
  // Turret 3 (Aft Turret, x = -70, y = -3)
  drawSuperTurret(ctx, -70, -3, turretAngle * 0.5, turretRecoil * 0.6);

  // 6. Massive Muzzle Flash Bloom on the forward turrets
  if (muzzleFlash > 0.05) {
    const flashMuzzles = [
      {tx: 65, ty: -3},
      {tx: 25, ty: -8},
    ];

    flashMuzzles.forEach(({tx, ty}) => {
      const barrelLen = 34;
      const mx = tx + Math.cos(turretAngle) * barrelLen;
      const my = ty + Math.sin(turretAngle) * barrelLen;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const bloomR = 48 * muzzleFlash;
      const mGrad = ctx.createRadialGradient(mx, my, 4, mx, my, bloomR);
      mGrad.addColorStop(0, 'rgba(255, 250, 210, 0.95)');
      mGrad.addColorStop(0.25, 'rgba(255, 180, 50, 0.7)');
      mGrad.addColorStop(0.65, 'rgba(220, 90, 20, 0.25)');
      mGrad.addColorStop(1, 'rgba(180, 30, 10, 0)');
      ctx.fillStyle = mGrad;
      ctx.beginPath();
      ctx.arc(mx, my, bloomR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = PALETTE.sandCream;
      ctx.beginPath();
      ctx.arc(mx, my, 8 * muzzleFlash, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.restore();
}

function drawSuperTurret(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  angle: number,
  recoil: number,
) {
  // Barbette ring
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(tx - 12, ty + 1, 24, 4);

  // Armored Turret House
  ctx.fillStyle = PALETTE.feldgrau;
  ctx.beginPath();
  ctx.moveTo(tx - 14, ty + 2);
  ctx.lineTo(tx + 12, ty + 2);
  ctx.lineTo(tx + 15, ty - 5);
  ctx.lineTo(tx - 12, ty - 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(tx - 11, ty - 4, 23, 5);

  // Triple Long Heavy Naval Barrels with Recoil
  ctx.save();
  ctx.translate(tx + 8, ty - 2);
  ctx.rotate(angle);

  const barrelRecoil = recoil * 7;
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(0 - barrelRecoil, -4, 28, 2.5);
  ctx.fillRect(0 - barrelRecoil, -1, 30, 2.5);
  ctx.fillRect(0 - barrelRecoil, 2, 28, 2.5);

  // Blast bags
  ctx.fillStyle = PALETTE.deepTaupe;
  ctx.fillRect(-2, -5, 4, 10);
  ctx.restore();
}

function drawAaaFlak(ctx: CanvasRenderingContext2D, factionColor: string, unit: CombatUnit, time = 0) {
  drawAmbientOcclusionShadow(ctx, 0, 8, 14, 4, 16);

  ctx.fillStyle = PALETTE.sandTan;
  ctx.fillRect(-10, 2, 20, 6);
  ctx.fillStyle = PALETTE.earthBrown;
  for (let i = -9; i < 9; i += 5) {
    ctx.fillRect(i, 2, 4, 3);
  }

  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(-5, -2, 10, 4);

  ctx.save();
  // Elevate steep skyward angle when firing or preparing AA
  const isAAShooting = unit.animRecoil > 0 || unit.animAnticipation > 0;
  const tilt = isAAShooting ? -1.25 : -0.8;
  ctx.rotate(tilt);
  ctx.fillStyle = PALETTE.navalSteel;
  ctx.fillRect(-2, -4, 18, 2);
  ctx.fillRect(-2, -1, 18, 2);
  ctx.fillStyle = PALETTE.bunkerCharcoal;
  ctx.fillRect(15, -5, 3, 4);
  ctx.fillRect(15, -2, 3, 4);

  // Twin Muzzle Flash Burst when firing
  if (unit.animRecoil > 0.15) {
    const flashLen = 6 * unit.animRecoil;
    // Barrel 1 muzzle flash
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(18, -5, flashLen, 3);
    // Barrel 2 muzzle flash
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(18, -2, flashLen, 3);

    // Muzzle bloom
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloom = ctx.createRadialGradient(20, -3, 1, 20, -3, 14 * unit.animRecoil);
    bloom.addColorStop(0, 'rgba(255, 250, 200, 0.95)');
    bloom.addColorStop(0.4, 'rgba(255, 180, 50, 0.6)');
    bloom.addColorStop(1, 'rgba(200, 60, 20, 0)');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(20, -3, 14 * unit.animRecoil, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawDamageSmoke(ctx: CanvasRenderingContext2D, time: number) {
  for (let i = 0; i < 3; i++) {
    const smokePhase = (time * 2 + i * 0.33) % 1;
    const sx = -6 + Math.sin(smokePhase * 5) * 4;
    const sy = -8 - smokePhase * 16;
    const radius = 2 + smokePhase * 5;

    ctx.fillStyle = smokePhase > 0.5 ? PALETTE.trenchMudBone : PALETTE.bunkerCharcoal;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1, radius), 0, Math.PI * 2);
    ctx.fill();

    if (smokePhase < 0.3) {
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(sx, sy + 4, 2, 2);
    }
  }
}

function drawDownedUnit(
  ctx: CanvasRenderingContext2D,
  unit: CombatUnit,
  factionColor: string,
  time: number,
  smokeAlpha = 1.0,
  noFire = false,
) {
  const alpha = unit.fadeAlpha !== undefined ? unit.fadeAlpha : 1.0;
  if (alpha <= 0.001) return;
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

  if (unit.type === 'infantry') {
    ctx.save();
    ctx.translate(1, 4);
    ctx.rotate(0.82);

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-6, 2, 4, 3);
    ctx.fillRect(-6, 6, 4, 3);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-3, 2, 6, 5);
    ctx.fillStyle = factionColor;
    ctx.fillRect(2, 0, 7, 6);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(7, 2, 4, 4);
    ctx.fillStyle = factionColor;
    ctx.fillRect(9, 0, 6, 4);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(8, 3, 7, 1.5);
    ctx.restore();

    ctx.fillStyle = PALETTE.earthBrown;
    ctx.fillRect(-9, 7, 9, 2);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(0, 7, 7, 1.5);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(7, 7, 2, 1);
  } else if (unit.type === 'tank') {
    ctx.save();
    ctx.rotate(0.12);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-20, 6, 16, 4);
    ctx.fillRect(-3, 8, 20, 3);
    ctx.fillRect(-18, 1, 35, 7);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-15, -4, 30, 6);
    ctx.fillStyle = factionColor;
    ctx.fillRect(-8, -4, 13, 5);

    ctx.save();
    ctx.translate(2, -7);
    ctx.rotate(-0.24);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-8, -5, 15, 6);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-3, -6, 5, 3);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(6, -3, 16, 3.5);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(21, -2, 4, 4);
    ctx.restore();
    ctx.restore();

    drawThinWreckageSmoke(ctx, time, -4, -7, smokeAlpha);
  } else if (unit.type === 'artillery' || unit.type === 'aaa') {
    ctx.save();
    ctx.rotate(0.2);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-12, 3, 14, 3);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.beginPath();
    ctx.arc(-2, 5, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = factionColor;
    ctx.fillRect(-2, -4, 4, 8);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.save();
    ctx.rotate(0.38);
    ctx.fillRect(0, -1, 16, 3);
    ctx.restore();
    ctx.restore();

    drawThinWreckageSmoke(ctx, time, 0, 0, smokeAlpha);
  } else if (unit.type === 'fighter' || unit.type === 'tactical_bomber' || unit.type === 'strategic_bomber') {
    ctx.save();
    ctx.rotate(0.16);
    ctx.fillStyle = PALETTE.deepTaupe;
    ctx.fillRect(-10, 0, 20, 6);
    ctx.fillStyle = factionColor;
    ctx.fillRect(-4, -1, 8, 4);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-6, -6, 12, 4);
    ctx.restore();

    drawThinWreckageSmoke(ctx, time, 2, 0, smokeAlpha);
  } else if (
    unit.type === 'battleship' ||
    unit.type === 'carrier' ||
    unit.type === 'cruiser' ||
    unit.type === 'destroyer' ||
    unit.type === 'submarine'
  ) {
    // --- NAVAL SINKING PHASE (LETHAL HIT) ---
    ctx.save();
    const sinkProgress = unit.sinkingProgress || 0;
    // 45 degrees tilt (0.785 rad)
    ctx.rotate(0.785);

    // Hull silhouette submerging into the waves
    const isBattleship = unit.type === 'battleship';
    const isCarrier = unit.type === 'carrier';
    const hullLen = isBattleship ? 76 : isCarrier ? 68 : unit.type === 'cruiser' ? 56 : 42;

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-hullLen / 2, 0, hullLen, 8);
    ctx.fillStyle = factionColor;
    ctx.fillRect(-hullLen / 2 + 2, -4, hullLen - 4, 6);
    ctx.fillStyle = PALETTE.crimson;
    ctx.fillRect(-hullLen / 2, 6, hullLen, 2); // boot-topping

    // Superstructure wreckage
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(-10, -10, 20, 8);

    // Secondary deck explosions (flashes omitted if noFire)
    if (!noFire) {
      const popSeed = Math.sin(time * 12 + unit.animBobOffset);
      if (popSeed > 0.3) {
        ctx.fillStyle = PALETTE.mustardBrass;
        ctx.fillRect(-6, -8, 5, 5);
        ctx.fillStyle = PALETTE.sandCream;
        ctx.fillRect(-4, -6, 3, 3);
      }
      if (Math.cos(time * 15 + unit.animBobOffset) > 0.4) {
        ctx.fillStyle = PALETTE.crimson;
        ctx.fillRect(8, -5, 6, 5);
        ctx.fillStyle = PALETTE.sandCream;
        ctx.fillRect(10, -3, 3, 3);
      }
    }

    ctx.restore();

    // Billowing black smoke plume rising from sinking ship (smoke only if noFire)
    drawShipDamageFireSmoke(ctx, time, -4, -6, noFire);

    // Churning sea foam and water waves lapping over submerging deck
    ctx.save();
    ctx.fillStyle = PALETTE.sandCream;
    const foamBob = Math.sin(time * 4) * 3;
    ctx.fillRect(-18, 4, 36, 2);
    ctx.fillRect(-12 + foamBob, 2, 24, 2);
    ctx.restore();
  } else {
    ctx.save();
    ctx.rotate(0.22);
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-18, 1, 36, 5);
    ctx.fillStyle = factionColor;
    ctx.fillRect(-14, -2, 26, 4);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(-6, -6, 10, 4);
    ctx.restore();

    drawThinWreckageSmoke(ctx, time, 0, -2, smokeAlpha);
  }
}

function drawThinWreckageSmoke(
  ctx: CanvasRenderingContext2D,
  time: number,
  baseX: number,
  baseY: number,
  smokeAlpha = 1.0,
) {
  if (smokeAlpha <= 0.01) return;
  for (let s = 0; s < 3; s++) {
    const p = (time * 1.6 + s * 0.33) % 1;
    const sx = baseX + Math.sin(p * 4) * 3 + p * 4;
    const sy = baseY - p * 15;
    const r = 2 + p * 3;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, smokeAlpha * (1 - p * 0.5)));
    ctx.fillStyle = p > 0.5 ? PALETTE.deepTaupe : PALETTE.bunkerCharcoal;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(1, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ============================================================================
// COMBAT VFX RENDERERS (ACTUAL RADIAL GRADIENT BLOOM & AMBIENT OCCLUSION)
// ============================================================================

export function drawBloodSplatters(ctx: CanvasRenderingContext2D, splatters: BloodSplatter[]) {
  splatters.forEach((b) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, b.life / b.maxLife);
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, Math.max(1, b.size), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

export function drawFlyingDebris(ctx: CanvasRenderingContext2D, debrisList: FlyingDebris[]) {
  debrisList.forEach((d) => {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rot);
    ctx.fillStyle = d.color;

    if (d.type === 'helmet') {
      ctx.beginPath();
      ctx.ellipse(0, 0, d.size + 1, d.size * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-d.size, 1, (d.size + 1) * 2, 1.5);
    } else if (d.type === 'rifle') {
      ctx.fillRect(-d.size * 2, -1, d.size * 4, 2.5);
      ctx.fillStyle = PALETTE.earthBrown;
      ctx.fillRect(-d.size * 2, -1, d.size * 2, 3);
    } else {
      ctx.fillRect(-d.size, -d.size, d.size * 2, d.size * 2);
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(-1, -1, 2, 2);
    }
    ctx.restore();
  });
}

/**
 * Draws billowing smoke puffs with support for the 2.0s post-casualty smooth dissipation fade.
 */
export function drawSmokePuffs(ctx: CanvasRenderingContext2D, puffs: SmokePuff[]) {
  puffs.forEach((p) => {
    ctx.save();
    const progress = Math.max(0, Math.min(1, 1 - p.life / p.maxLife));
    const r = Math.max(2, p.radius + progress * (p.maxRadius - p.radius));
    const cx = Math.round(p.x);
    const cy = Math.round(p.y);

    // Smooth post-casualty fade factor if fadeTimer is active
    let fadeMult = 1.0;
    if (p.fadeTimer !== undefined) {
      fadeMult = Math.max(0, Math.min(1, p.fadeTimer / (p.maxFadeTimer || 2.0)));
    }

    if (progress < 0.3) {
      ctx.globalAlpha = 0.95 * fadeMult;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      const lobeR = Math.max(2, r * 0.75);
      ctx.beginPath();
      ctx.arc(cx - lobeR * 0.35, cy - lobeR * 0.3, lobeR, 0, Math.PI * 2);
      ctx.arc(cx + lobeR * 0.4, cy - lobeR * 0.25, lobeR * 0.85, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.beginPath();
      ctx.arc(cx, cy + 1, Math.max(1, r * 0.45), 0, Math.PI * 2);
      ctx.fill();
    } else if (progress < 0.7) {
      ctx.globalAlpha = Math.max(0.08, (0.9 - progress * 0.65) * fadeMult);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, r * 0.58), 0, Math.PI * 2);
      ctx.arc(cx + r * 0.3, cy - r * 0.25, Math.max(1, r * 0.45), 0, Math.PI * 2);
      ctx.fill();

      // Outer soft ring
      const step = 2;
      const intR = Math.round(r);
      const innerR2 = (r * 0.45) * (r * 0.45);
      const outerR2 = r * r;
      for (let dy = -intR; dy <= intR; dy += step) {
        for (let dx = -intR; dx <= intR; dx += step) {
          const d2 = dx * dx + dy * dy;
          if (d2 >= innerR2 && d2 <= outerR2) {
            if (((Math.floor(cx + dx) + Math.floor(cy + dy)) & 2) === 0) {
              ctx.fillRect(cx + dx, cy + dy, step, step);
            }
          }
        }
      }
    } else {
      ctx.globalAlpha = Math.max(0.04, ((1 - progress) * 0.75) * fadeMult);
      ctx.fillStyle =
        p.color === PALETTE.sandCream || p.color === PALETTE.trenchMudBone
          ? PALETTE.trenchMudBone
          : PALETTE.deepTaupe;

      const step = 2;
      const intR = Math.round(r);
      const outerR2 = r * r;
      for (let dy = -intR; dy <= intR; dy += step) {
        for (let dx = -intR; dx <= intR; dx += step) {
          const d2 = dx * dx + dy * dy;
          if (d2 <= outerR2) {
            if (((Math.floor(cx + dx) ^ Math.floor(cy + dy)) & 3) === 0) {
              ctx.fillRect(cx + dx, cy + dy, 2, 2);
            }
          }
        }
      }
    }

    ctx.restore();
  });
}

/**
 * Draws persistent burning ground fires with ACTUAL AMBIENT OCCLUSION SOOT at base
 * and ACTUAL CANVAS 2D RADIAL GRADIENT BLOOM GLOW around flames.
 * Supports smooth 2.0s post-casualty dissipation fade.
 */
export function drawGroundFires(
  ctx: CanvasRenderingContext2D,
  fires: GroundFire[],
  time: number,
) {
  fires.forEach((fire) => {
    ctx.save();
    const cx = Math.round(fire.x);
    const cy = Math.round(fire.y);
    const fireAlpha = fire.alpha !== undefined ? Math.max(0, Math.min(1, fire.alpha)) : 1.0;
    const baseIntensity = fire.intensity !== undefined ? fire.intensity : 1.0;
    const intensity = baseIntensity * fireAlpha;
    if (intensity <= 0.01 || fireAlpha <= 0.01) {
      ctx.restore();
      return;
    }
    ctx.globalAlpha = fireAlpha;

    const r = fire.radius * Math.max(0.25, intensity);
    const charR = fire.charredRadius * Math.max(0.35, intensity);

    // 1. ACTUAL AMBIENT OCCLUSION & CHARRED SOOT DROP SHADOW AT THE BASE
    const aoGrad = ctx.createRadialGradient(cx, cy + 2, charR * 0.15, cx, cy + 2, charR * 1.15);
    aoGrad.addColorStop(0, 'rgba(20, 16, 22, 0.85)');
    aoGrad.addColorStop(0.5, 'rgba(38, 30, 36, 0.55)');
    aoGrad.addColorStop(0.85, 'rgba(55, 45, 52, 0.18)');
    aoGrad.addColorStop(1, 'rgba(55, 45, 52, 0)');
    ctx.fillStyle = aoGrad;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, charR * 1.15, Math.max(3, charR * 0.65), 0, 0, Math.PI * 2);
    ctx.fill();

    // Dark contact crevice line
    ctx.fillStyle = 'rgba(12, 10, 14, 0.9)';
    ctx.fillRect(cx - Math.round(r * 0.8), cy + 1, Math.round(r * 1.6), 2);

    // 2. ACTUAL RADIAL GRADIENT BLOOM GLOW (replaces pure dither pattern)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloomPulse = Math.sin(time * 12 + fire.flickerOffset) * 2;
    const bloomOuterR = Math.max(4, (charR * 1.6 + bloomPulse) * Math.max(0.3, intensity));
    const fireBloom = ctx.createRadialGradient(cx, cy - 2, 2, cx, cy - 2, bloomOuterR);
    fireBloom.addColorStop(0, `rgba(255, 220, 110, ${0.75 * intensity})`);
    fireBloom.addColorStop(0.3, `rgba(245, 140, 45, ${0.45 * intensity})`);
    fireBloom.addColorStop(0.65, `rgba(200, 60, 20, ${0.18 * intensity})`);
    fireBloom.addColorStop(1, 'rgba(150, 30, 10, 0)');
    ctx.fillStyle = fireBloom;
    ctx.beginPath();
    ctx.arc(cx, cy - 2, bloomOuterR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 3. BURNING EMBER COAL BED
    ctx.fillStyle = PALETTE.plum;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(2, r * 0.85), Math.max(1, r * 0.48), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = PALETTE.crimson;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1, Math.max(1, r * 0.55), Math.max(1, r * 0.32), 0, 0, Math.PI * 2);
    ctx.fill();

    // 4. PROCEDURAL FLICKERING FLAME TONGUES
    const flameCount = 4;
    for (let f = 0; f < flameCount; f++) {
      const tongueOffset = (f - (flameCount - 1) / 2) * (r * 0.42);
      const flameSeed = time * 13 + fire.flickerOffset + f * 2.2;
      const flickerH = Math.sin(flameSeed) * 0.35 + Math.cos(flameSeed * 1.7) * 0.25 + 0.65;
      const flameHeight = Math.max(3, r * 1.65 * flickerH * intensity);
      const flameWidth = Math.max(1.5, (r * 0.38) * (1 - f * 0.1) * intensity);

      const tx = Math.round(cx + tongueOffset);
      const ty = Math.round(cy);

      // Deep Crimson outer flame
      ctx.fillStyle = PALETTE.crimson;
      ctx.fillRect(tx - flameWidth, ty - flameHeight, flameWidth * 2, flameHeight);

      // Warm Terracotta mid layer
      ctx.fillStyle = PALETTE.terracotta;
      ctx.fillRect(
        tx - Math.max(1, flameWidth - 1),
        ty - Math.round(flameHeight * 0.85),
        Math.max(2, (flameWidth - 1) * 2),
        Math.round(flameHeight * 0.85),
      );

      // Mustard Brass hot core
      ctx.fillStyle = PALETTE.mustardBrass;
      ctx.fillRect(
        tx - Math.max(1, flameWidth * 0.5),
        ty - Math.round(flameHeight * 0.65),
        Math.max(1, flameWidth),
        Math.round(flameHeight * 0.65),
      );

      // Sand Cream tip
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(
        tx - 1,
        ty - Math.round(flameHeight + 1),
        2,
        Math.max(1, Math.round(flameHeight * 0.35)),
      );

      if (Math.sin(flameSeed * 2.3) > 0.3 && intensity > 0.4) {
        ctx.fillRect(tx, ty - Math.round(flameHeight + 4), 2, 2);
      }
    }

    ctx.restore();
  });
}

export function drawDroppingBombs(
  ctx: CanvasRenderingContext2D,
  bombs: {x: number; y: number; vx: number; vy: number}[],
) {
  bombs.forEach((b) => {
    ctx.save();
    ctx.translate(Math.round(b.x), Math.round(b.y));
    const angle = Math.atan2(b.vy, b.vx);
    ctx.rotate(angle);

    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(-5, -2.5, 10, 5);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(-3, -2, 6, 4);

    ctx.fillStyle = PALETTE.trenchMudBone;
    ctx.fillRect(4, -1.5, 2, 3);

    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(-7, -3.5, 2, 7);
    ctx.fillStyle = PALETTE.crimson;
    ctx.fillRect(-6, -2, 1, 4);

    ctx.restore();
  });
}

export function drawShockwaves(ctx: CanvasRenderingContext2D, shockwaves: Shockwave[]) {
  shockwaves.forEach((sw) => {
    ctx.save();
    const alpha = Math.max(0, sw.life / sw.maxLife);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = sw.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sw.x, sw.y, Math.max(1, sw.radius), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
}

/**
 * Draws water geyser splash explosions from torpedo impacts and heavy naval ordnance
 */
export function drawWaterGeysers(
  ctx: CanvasRenderingContext2D,
  geysers: WaterGeyser[],
) {
  geysers.forEach((g) => {
    ctx.save();
    const progress = Math.max(0, Math.min(1, 1 - g.life / g.maxLife));
    const alpha = Math.max(0, Math.min(1, g.life / g.maxLife));
    ctx.globalAlpha = alpha;

    const gx = Math.round(g.x);
    const gy = Math.round(g.y);

    // Height envelope: erupts quickly up, lingers, then collapses
    const hProgress = progress < 0.28 ? progress / 0.28 : Math.max(0, 1 - (progress - 0.28) / 0.72);
    const curH = Math.round(g.maxHeight * hProgress);

    // 1. Concentric Water Surface Ripple Rings
    const ringR = Math.max(4, g.width * (0.5 + progress * 1.6));
    ctx.strokeStyle = PALETTE.sandCream;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(gx, gy, ringR, ringR * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = PALETTE.spruceSea;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(gx, gy, ringR * 0.65, ringR * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Churning Vertical Water Geyser Column
    if (curH > 2) {
      // Spruce sea core
      ctx.fillStyle = PALETTE.spruceSea;
      ctx.beginPath();
      ctx.moveTo(gx - g.width * 0.5, gy);
      ctx.lineTo(gx - g.width * 0.3, gy - curH * 0.6);
      ctx.lineTo(gx - g.width * 0.15, gy - curH);
      ctx.lineTo(gx + g.width * 0.15, gy - curH);
      ctx.lineTo(gx + g.width * 0.3, gy - curH * 0.6);
      ctx.lineTo(gx + g.width * 0.5, gy);
      ctx.closePath();
      ctx.fill();

      // White foam outer spray
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(gx - 4, gy - curH, 8, Math.max(3, curH * 0.35));
      ctx.fillRect(gx - 2, gy - curH - 3, 4, 3); // Geyser crown

      // Spray droplets showering in fountain arc
      const dropletCount = 6;
      for (let i = 0; i < dropletCount; i++) {
        const spreadX = ((i - 2.5) / 2.5) * (g.width * (0.8 + progress));
        const dropY = gy - curH * (0.3 + 0.6 * (1 - Math.abs(i - 2.5) / 3)) + progress * 14;
        ctx.fillStyle = i % 2 === 0 ? PALETTE.sandCream : PALETTE.trenchMudBone;
        ctx.fillRect(Math.round(gx + spreadX), Math.round(dropY), 2.5, 2.5);
      }
    }

    ctx.restore();
  });
}

export function drawPlaneSortie(
  ctx: CanvasRenderingContext2D,
  sortie: PlaneSortie,
  time: number,
  factionColor: string,
  noPlaneShadow = false,
) {
  ctx.save();

  // Smooth fade out drop shadows during takeoff / attack runs, and fade back in on return / landing
  if (!noPlaneShadow) {
    let shadowAlpha = 1.0;
    if (sortie.progress < 0.22) {
      shadowAlpha = Math.max(0, 1.0 - (sortie.progress / 0.22));
    } else if (sortie.progress > 0.78) {
      shadowAlpha = Math.min(1.0, (sortie.progress - 0.78) / 0.22);
    } else {
      shadowAlpha = 0;
    }

    if (shadowAlpha > 0.005) {
      // Ground drop shadow follows plane X while staying grounded near home base level
      const groundShadowY = Math.round(sortie.homeY + 18 + (sortie.currentY + 28 - (sortie.homeY + 18)) * (1 - shadowAlpha));
      drawAmbientOcclusionShadow(
        ctx,
        Math.round(sortie.currentX),
        groundShadowY,
        22 + (1 - shadowAlpha) * 6,
        6 + (1 - shadowAlpha) * 2,
        18,
        shadowAlpha,
      );
    }
  }

  // Plane position & rotation
  ctx.translate(Math.round(sortie.currentX), Math.round(sortie.currentY));
  ctx.rotate(sortie.currentRot);

  if (sortie.side === 'defender') {
    ctx.scale(-1, 1);
  }

  if (sortie.unitType === 'fighter') {
    ctx.fillStyle = factionColor;
    ctx.fillRect(-10, -4, 20, 8);
    ctx.fillRect(-4, -14, 10, 28);
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(10, -3, 3, 6);
    ctx.fillStyle = PALETTE.spruceSea;
    ctx.fillRect(-2, -3, 5, 6);

    // Muzzle flash at gun port during firing bursts
    if (sortie.bulletBurstsFired > 0) {
      const wingOffsets = [-8, 8];
      wingOffsets.forEach((wingY) => {
        // Actual small radial bloom flash
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fGrad = ctx.createRadialGradient(12, wingY, 1, 12, wingY, 8);
        fGrad.addColorStop(0, 'rgba(255, 250, 200, 0.9)');
        fGrad.addColorStop(0.4, 'rgba(240, 180, 60, 0.45)');
        fGrad.addColorStop(1, 'rgba(200, 100, 20, 0)');
        ctx.fillStyle = fGrad;
        ctx.beginPath();
        ctx.arc(12, wingY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = PALETTE.sandCream;
        ctx.fillRect(10, wingY - 1.5, 4, 3);
      });
    }
  } else {
    ctx.fillStyle = factionColor;
    ctx.fillRect(-16, -6, 32, 12);
    ctx.fillRect(-6, -20, 16, 40);
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.fillRect(0, -14, 8, 4);
    ctx.fillRect(0, 10, 8, 4);
    ctx.fillStyle = PALETTE.spruceSea;
    ctx.fillRect(10, -4, 5, 8);

    if (sortie.bombsDropped > 0) {
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.fillRect(-4, -2, 10, 5);
      ctx.fillStyle = PALETTE.terracotta;
      ctx.fillRect(-6, -2, 2, 5);
      ctx.fillRect(6, -2, 2, 5);
    }
  }

  ctx.restore();
}

/**
 * Full 3x5 Pixel Font Matrix for Retro Combat HUD, VICTORY Banners & Hit Numbers
 */
export const PIXEL_GLYPHS: Record<string, number[][]> = {
  'A': [
    [0, 1, 0],
    [1, 0, 1],
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'B': [
    [1, 1, 0],
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 1],
    [1, 1, 0],
  ],
  'C': [
    [0, 1, 1],
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    [0, 1, 1],
  ],
  'D': [
    [1, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 0],
  ],
  'E': [
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
  'F': [
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 0],
    [1, 0, 0],
  ],
  'G': [
    [0, 1, 1],
    [1, 0, 0],
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
  ],
  'H': [
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'I': [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 1],
  ],
  'J': [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 0],
  ],
  'K': [
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
  ],
  'L': [
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
  'M': [
    [1, 0, 1],
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'N': [
    [1, 0, 1],
    [1, 1, 1],
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'O': [
    [0, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 0],
  ],
  'P': [
    [1, 1, 0],
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 0],
    [1, 0, 0],
  ],
  'Q': [
    [0, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 0],
    [0, 1, 1],
  ],
  'R': [
    [1, 1, 0],
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'S': [
    [0, 1, 1],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 0],
  ],
  'T': [
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ],
  'U': [
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
  ],
  'V': [
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 0],
  ],
  'W': [
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [1, 0, 1],
  ],
  'X': [
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 0],
    [1, 0, 1],
    [1, 0, 1],
  ],
  'Y': [
    [1, 0, 1],
    [1, 0, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ],
  'Z': [
    [1, 1, 1],
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
  '0': [
    [1, 1, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
  ],
  '1': [
    [0, 1, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 1],
  ],
  '2': [
    [1, 1, 0],
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
    [1, 1, 1],
  ],
  '3': [
    [1, 1, 0],
    [0, 0, 1],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 0],
  ],
  '4': [
    [1, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 0, 1],
    [0, 0, 1],
  ],
  '5': [
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 1, 0],
  ],
  '6': [
    [0, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
    [0, 1, 0],
  ],
  '7': [
    [1, 1, 1],
    [0, 0, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ],
  '8': [
    [0, 1, 0],
    [1, 0, 1],
    [0, 1, 0],
    [1, 0, 1],
    [0, 1, 0],
  ],
  '9': [
    [0, 1, 0],
    [1, 0, 1],
    [0, 1, 1],
    [0, 0, 1],
    [0, 1, 0],
  ],
  '+': [
    [0, 1, 0],
    [1, 1, 1],
    [0, 1, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
  '-': [
    [0, 0, 0],
    [0, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
    [0, 0, 0],
  ],
  ':': [
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ],
  '!': [
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [0, 0, 0],
    [0, 1, 0],
  ],
  ' ': [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ],
};

export function drawPixelString(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  startY: number,
  pixelSize = 3,
  color: string = PALETTE.sandCream,
  shadowColor: string = PALETTE.bunkerCharcoal,
) {
  const glyphW = 3;
  const glyphH = 5;
  const letterSpacing = pixelSize;

  const totalWidth = text.length * (glyphW * pixelSize + letterSpacing) - letterSpacing;
  let curX = Math.round(centerX - totalWidth / 2);
  const curY = Math.round(startY);

  for (let i = 0; i < text.length; i++) {
    const char = text[i].toUpperCase();
    const bitmap = PIXEL_GLYPHS[char];
    if (bitmap) {
      if (shadowColor) {
        ctx.fillStyle = shadowColor;
        for (let r = 0; r < glyphH; r++) {
          for (let c = 0; c < glyphW; c++) {
            if (bitmap[r][c]) {
              ctx.fillRect(
                curX + c * pixelSize + 1,
                curY + r * pixelSize + 1,
                pixelSize,
                pixelSize,
              );
            }
          }
        }
      }

      ctx.fillStyle = color;
      for (let r = 0; r < glyphH; r++) {
        for (let c = 0; c < glyphW; c++) {
          if (bitmap[r][c]) {
            ctx.fillRect(
              curX + c * pixelSize,
              curY + r * pixelSize,
              pixelSize,
              pixelSize,
            );
          }
        }
      }
    }
    curX += glyphW * pixelSize + letterSpacing;
  }
}

export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  startX: number,
  startY: number,
  color: string,
  accentColor: string,
) {
  const pixelSize = 2;
  const glyphW = 3;
  const glyphH = 5;
  const letterSpacing = 2;

  const totalWidth = text.length * (glyphW * pixelSize + letterSpacing) - letterSpacing;
  let curX = Math.round(startX - totalWidth / 2);
  const curY = Math.round(startY);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const bitmap = PIXEL_GLYPHS[char];
    if (bitmap) {
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      for (let r = 0; r < glyphH; r++) {
        for (let c = 0; c < glyphW; c++) {
          if (bitmap[r][c]) {
            ctx.fillRect(curX + c * pixelSize + 1, curY + r * pixelSize + 1, pixelSize, pixelSize);
            ctx.fillRect(curX + c * pixelSize + 2, curY + r * pixelSize + 2, pixelSize, pixelSize);
          }
        }
      }

      ctx.fillStyle = accentColor;
      for (let r = 0; r < glyphH; r++) {
        for (let c = 0; c < glyphW; c++) {
          if (bitmap[r][c]) {
            ctx.fillRect(curX + c * pixelSize, curY + r * pixelSize + 1, pixelSize, pixelSize);
          }
        }
      }

      ctx.fillStyle = color;
      for (let r = 0; r < glyphH; r++) {
        for (let c = 0; c < glyphW; c++) {
          if (bitmap[r][c]) {
            ctx.fillRect(curX + c * pixelSize, curY + r * pixelSize, pixelSize, pixelSize);
          }
        }
      }
    }
    curX += glyphW * pixelSize + letterSpacing;
  }
}

export function drawFloatingTexts(
  ctx: CanvasRenderingContext2D,
  texts: FloatingText[],
) {
  texts.forEach((ft) => {
    ctx.save();
    const alpha = Math.max(0, ft.life / ft.maxLife);
    ctx.globalAlpha = alpha;
    drawPixelText(ctx, ft.text, ft.x, ft.y, ft.color, ft.accentColor);
    ctx.restore();
  });
}

// ============================================================================
// PROCEDURAL FULL-SCREEN WAVING FLAG & VICTORY SEQUENCE RENDERER
// ============================================================================

/**
 * Renders a full-screen dynamic procedural waving flag in an infinite loop
 * using the 16-color military palette with cloth ripples and fold shading.
 */
export function drawProceduralWavingFlag(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  theater: TheaterId,
) {
  ctx.save();

  // Flag parameters: 13 stripes standard / faction motif
  const stripeCount = 13;
  const stripeH = height / stripeCount;
  const cantonW = Math.round(width * 0.42);
  const cantonH = Math.round(stripeH * 7);

  // Column-based wave displacement and lighting
  const colStep = 5; // Fast rendering across screen width
  const totalCols = Math.ceil(width / colStep);

  for (let c = 0; c < totalCols; c++) {
    const colX = c * colStep;

    // Overlapping sine waves for fluid silk/wool banner drape
    const wave1 = Math.sin(colX * 0.011 - time * 3.4) * 24;
    const wave2 = Math.sin(colX * 0.026 - time * 4.6 + 1.2) * 12;
    const waveY = wave1 + wave2;

    // Surface gradient / slope for lighting calculation
    const slope =
      Math.cos(colX * 0.011 - time * 3.4) * 24 * 0.011 +
      Math.cos(colX * 0.026 - time * 4.6 + 1.2) * 12 * 0.026;

    // 1. Draw Flag Stripes / Field for this vertical slice
    for (let s = 0; s < stripeCount; s++) {
      const baseSy = s * stripeH;
      const sy = baseSy + waveY;

      // Color scheme based on victorious theater
      let stripeColor: string;
      if (theater === 'eastern') {
        // Red Army Guard: Soviet Crimson field with subtle tone variations
        stripeColor = s % 2 === 0 ? PALETTE.crimson : PALETTE.plum;
      } else if (theater === 'north_africa') {
        // Desert Rats: Alternating Khaki Leather & Sand Tan stripes
        stripeColor = s % 2 === 0 ? PALETTE.khakiLeather : PALETTE.sandTan;
      } else if (theater === 'pacific' || theater === 'navy_test' || theater === 'air_strike_test') {
        // US Navy Task Force / Air Strike: Naval Steel & Sand Cream stripes
        stripeColor = s % 2 === 0 ? PALETTE.navalSteel : PALETTE.sandCream;
      } else {
        // European Test (Coast / Forest) / Allied Forces: Crimson & Sand Cream stripes
        stripeColor = s % 2 === 0 ? PALETTE.crimson : PALETTE.sandCream;
      }

      ctx.fillStyle = stripeColor;
      ctx.fillRect(colX, sy, colStep + 0.5, stripeH + 1);
    }

    // 2. Draw Canton (Upper Left Section)
    if (colX < cantonW) {
      const cantonSliceH = cantonH + waveY;
      let cantonColor: string = PALETTE.navalSteel;

      if (theater === 'eastern') {
        cantonColor = PALETTE.plum;
      } else if (theater === 'north_africa') {
        cantonColor = PALETTE.earthBrown;
      }

      ctx.fillStyle = cantonColor;
      ctx.fillRect(colX, waveY, colStep + 0.5, cantonH);

      // Gold canton border line
      ctx.fillStyle = PALETTE.sandCream;
      ctx.fillRect(colX, cantonSliceH - 2, colStep + 0.5, 3);
    }

    // 3. Cloth Ripple Fold Shading Overlay
    // Light highlights on wave crests, dark shadows in wave troughs
    if (slope < -0.12) {
      // Deep shadow fold
      const shadowAlpha = Math.min(0.55, (-slope - 0.12) * 0.75);
      ctx.fillStyle = PALETTE.bunkerCharcoal;
      ctx.globalAlpha = shadowAlpha;
      ctx.fillRect(colX, 0, colStep + 0.5, height);
      ctx.globalAlpha = 1.0;
    } else if (slope > 0.12) {
      // Raised ridge highlight
      const highlightAlpha = Math.min(0.35, (slope - 0.12) * 0.55);
      ctx.fillStyle = PALETTE.sandCream;
      ctx.globalAlpha = highlightAlpha;
      ctx.fillRect(colX, 0, colStep + 0.5, height);
      ctx.globalAlpha = 1.0;
    }
  }

  // 4. Canton Emblem / Stars (Drawn on top with wave offset)
  const cantonCenterX = Math.round(cantonW / 2);
  const cantonWave =
    Math.sin(cantonCenterX * 0.011 - time * 3.4) * 24 +
    Math.sin(cantonCenterX * 0.026 - time * 4.6 + 1.2) * 12;

  if (theater === 'eastern') {
    // Red Army Golden Star & Laurel Wreath in Canton
    const starX = cantonCenterX;
    const starY = Math.round(cantonH / 2 + cantonWave);
    drawGoldStarEmblem(ctx, starX, starY, 32, true);
  } else {
    // 5x4 Grid of 5-Point Stars in Canton
    const starCols = 6;
    const starRows = 4;
    const stepX = (cantonW - 40) / (starCols - 1);
    const stepY = (cantonH - 40) / (starRows - 1);

    for (let r = 0; r < starRows; r++) {
      for (let c = 0; c < starCols; c++) {
        const sx = 20 + c * stepX;
        const starWave =
          Math.sin(sx * 0.011 - time * 3.4) * 24 +
          Math.sin(sx * 0.026 - time * 4.6 + 1.2) * 12;
        const sy = 20 + r * stepY + starWave;
        drawPixelStar(ctx, Math.round(sx), Math.round(sy), 4, PALETTE.sandCream);
      }
    }
  }

  // 5. Subtle horizontal cloth weave line texture
  ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
  for (let y = 0; y < height; y += 4) {
    ctx.fillRect(0, y, width, 1);
  }

  ctx.restore();
}

/**
 * Draws a 5-point retro pixel star
 */
function drawPixelStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draws a prominent golden victory star & laurel wreath
 */
function drawGoldStarEmblem(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  withWreath = true,
) {
  ctx.save();

  if (withWreath) {
    // Laurel Wreath
    ctx.strokeStyle = PALETTE.mustardBrass;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.25, 0.4, Math.PI - 0.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.25, Math.PI + 0.4, 2 * Math.PI - 0.4);
    ctx.stroke();

    // Wreath leaf clusters
    ctx.fillStyle = PALETTE.sandCream;
    for (let a = 0.5; a < Math.PI - 0.5; a += 0.45) {
      const lx1 = cx + Math.cos(a) * radius * 1.25;
      const ly1 = cy + Math.sin(a) * radius * 1.25;
      ctx.fillRect(lx1 - 2, ly1 - 2, 4, 4);

      const lx2 = cx + Math.cos(a + Math.PI) * radius * 1.25;
      const ly2 = cy + Math.sin(a + Math.PI) * radius * 1.25;
      ctx.fillRect(lx2 - 2, ly2 - 2, 4, 4);
    }
  }

  // Central Gold Star
  ctx.fillStyle = PALETTE.mustardBrass;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  // Inner Bright Star Core
  ctx.fillStyle = PALETTE.sandCream;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const px = cx + Math.cos(angle) * (radius * 0.55);
    const py = cy + Math.sin(angle) * (radius * 0.55);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Draws the Expanding VICTORY Modal with Regional Banner,
 * Circular Faction Emblems, Dynamic IPC Display, and "RETURN TO COMBAT" Button.
 */
export function drawVictorySequenceModal(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  flagElapsed: number,
  regionName: string,
  attackerIpc: number,
  defenderIpc: number,
  returnLabel = 'RETURN TO COMBAT',
): {returnButtonRect: {x: number; y: number; w: number; h: number}} {
  ctx.save();

  // Expansion animation: smoothly scales outward from center
  const expandDuration = 0.65;
  const progress = Math.min(1, Math.max(0, (flagElapsed - 0.15) / expandDuration));
  // Cubic ease-out
  const ease = 1 - Math.pow(1 - progress, 3);

  const targetW = 760;
  const targetH = 190;
  const curW = Math.round(targetW * ease);
  const curH = Math.round(targetH * ease);

  const centerX = Math.round(width / 2);
  const centerY = Math.round(height / 2 - 25);

  const bx = centerX - Math.round(curW / 2);
  const by = centerY - Math.round(curH / 2);

  // Return button coordinates
  const btnW = 270;
  const btnH = 54;
  const btnX = centerX - Math.round(btnW / 2);
  const btnY = centerY + Math.round(targetH / 2) + 26;
  const returnButtonRect = {x: btnX, y: btnY, w: btnW, h: btnH};

  if (curW > 10 && curH > 10) {
    // 1. Drop shadow behind the expanding central box
    ctx.fillStyle = 'rgba(20, 16, 22, 0.85)';
    ctx.fillRect(bx + 6, by + 6, curW, curH);

    // 2. Leather & Brass Bevel Frame
    ctx.fillStyle = PALETTE.khakiLeather;
    ctx.fillRect(bx - 4, by - 4, curW + 8, curH + 8);

    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.fillRect(bx - 2, by - 2, curW + 4, curH + 4);

    // 3. Deep Bunker Charcoal Felt interior
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(bx, by, curW, curH);

    // Corner rivet details in sand cream
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(bx + 4, by + 4, 3, 3);
    ctx.fillRect(bx + curW - 7, by + 4, 3, 3);
    ctx.fillRect(bx + 4, by + curH - 7, 3, 3);
    ctx.fillRect(bx + curW - 7, by + curH - 7, 3, 3);

    // Inner subtle dividing hairline
    ctx.strokeStyle = PALETTE.deepTaupe;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + 18, by + 74);
    ctx.lineTo(bx + curW - 18, by + 74);
    ctx.stroke();
  }

  // Content fades in once the box has expanded sufficiently (progress > 0.65)
  const contentAlpha = Math.min(1, Math.max(0, (progress - 0.65) / 0.35));

  if (contentAlpha > 0.01) {
    ctx.globalAlpha = contentAlpha;

    // --- ABOVE THE BOX: "You successfully took REGION" ---
    const upperTextY = by - 18;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Drop shadow
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.font = 'bold 15px "Courier New", monospace';
    ctx.fillText(`YOU SUCCESSFULLY TOOK ${regionName.toUpperCase()}`, centerX + 1, upperTextY + 1);

    // Brass/Sand Cream Main Text
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillText(`YOU SUCCESSFULLY TOOK ${regionName.toUpperCase()}`, centerX, upperTextY);

    // --- CENTER OF THE BOX: "VICTORY" IN LARGE BOLD PIXEL LETTERING ---
    const victoryY = by + 22;
    drawPixelString(
      ctx,
      'VICTORY',
      centerX,
      victoryY,
      6, // Large 6x pixel size
      PALETTE.sandCream,
      PALETTE.plum,
    );

    // --- CIRCULAR EMBLEMS & IPC DISPLAY ---
    // ATTACKER EMBLEM (LEFT SIDE)
    const atkCenterX = centerX - 190;
    const emblemsY = by + 124;

    // Attacker Circular Emblem
    ctx.save();
    // Outer brass rim
    ctx.fillStyle = PALETTE.mustardBrass;
    ctx.beginPath();
    ctx.arc(atkCenterX, emblemsY, 26, 0, Math.PI * 2);
    ctx.fill();

    // Inner naval steel / spruce circle
    ctx.fillStyle = PALETTE.navalSteel;
    ctx.beginPath();
    ctx.arc(atkCenterX, emblemsY, 22, 0, Math.PI * 2);
    ctx.fill();

    // Golden 5-point star inside emblem
    drawGoldStarEmblem(ctx, atkCenterX, emblemsY, 12, false);

    // Attacker IPC Number & Label
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.trenchMudBone;
    ctx.font = 'bold 11px monospace';
    ctx.fillText('ATTACKER', atkCenterX + 36, emblemsY - 10);

    // Dynamic IPC Value in bold pixel string & font
    ctx.fillStyle = PALETTE.sandCream;
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`${attackerIpc} IPC`, atkCenterX + 36, emblemsY + 10);
    ctx.restore();

    // DEFENDER EMBLEM (RIGHT SIDE)
    const defCenterX = centerX + 60;

    // Defender Circular Emblem
    ctx.save();
    // Outer steel rim
    ctx.fillStyle = PALETTE.feldgrau;
    ctx.beginPath();
    ctx.arc(defCenterX, emblemsY, 26, 0, Math.PI * 2);
    ctx.fill();

    // Inner deep plum / wine circle
    ctx.fillStyle = PALETTE.plum;
    ctx.beginPath();
    ctx.arc(defCenterX, emblemsY, 22, 0, Math.PI * 2);
    ctx.fill();

    // Crossed Swords / Fortress Iron Shield
    ctx.fillStyle = PALETTE.terracotta;
    ctx.fillRect(defCenterX - 11, emblemsY - 2, 22, 4);
    ctx.fillRect(defCenterX - 2, emblemsY - 11, 4, 22);
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(defCenterX - 4, emblemsY - 4, 8, 8);

    // Defender IPC Number & Label
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.trenchMudBone;
    ctx.font = 'bold 11px monospace';
    ctx.fillText('DEFENDER', defCenterX + 36, emblemsY - 10);

    // Dynamic IPC Value in bold font
    ctx.fillStyle = PALETTE.terracotta;
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`${defenderIpc} IPC`, defCenterX + 36, emblemsY + 10);
    ctx.restore();
  }

  // --- UNDERNEATH: "RETURN TO COMBAT" BUTTON ---
  // Fades in smoothly when the flag appears (flagElapsed > 0.4s)
  const buttonAlpha = Math.min(1, Math.max(0, (flagElapsed - 0.4) / 0.5));

  if (buttonAlpha > 0.01) {
    ctx.globalAlpha = buttonAlpha;

    // Drop shadow in bunker charcoal
    ctx.fillStyle = PALETTE.bunkerCharcoal;
    ctx.fillRect(btnX + 4, btnY + 4, btnW, btnH);

    // Red background: #9A4E48 (Crimson)
    ctx.fillStyle = PALETTE.crimson;
    ctx.fillRect(btnX, btnY, btnW, btnH);

    // Bevel light top/left edges
    ctx.fillStyle = '#b85f57';
    ctx.fillRect(btnX, btnY, btnW, 2);
    ctx.fillRect(btnX, btnY, 2, btnH);

    // Bevel dark bottom/right edges
    ctx.fillStyle = PALETTE.plum;
    ctx.fillRect(btnX, btnY + btnH - 2, btnW, 2);
    ctx.fillRect(btnX + btnW - 2, btnY, 2, btnH);

    // Pulsing radiant border #DFCE91 / #A1A258
    const pulse = (Math.sin(time * 6) + 1) / 2;
    ctx.strokeStyle = pulse > 0.4 ? PALETTE.sandCream : PALETTE.terracotta;
    ctx.lineWidth = 2;
    ctx.strokeRect(btnX + 2, btnY + 2, btnW - 4, btnH - 4);

    // Corner rivets
    ctx.fillStyle = PALETTE.sandCream;
    ctx.fillRect(btnX + 4, btnY + 4, 2, 2);
    ctx.fillRect(btnX + btnW - 6, btnY + 4, 2, 2);
    ctx.fillRect(btnX + 4, btnY + btnH - 6, 2, 2);
    ctx.fillRect(btnX + btnW - 6, btnY + btnH - 6, 2, 2);

    // "RETURN TO COMBAT" in pixel text
    drawPixelString(
      ctx,
      returnLabel,
      centerX,
      btnY + 13,
      3,
      PALETTE.sandCream,
      PALETTE.plum,
    );

    // Subtitle prompt
    ctx.fillStyle = PALETTE.sandCream;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('[ CLICK OR SPACE TO ADVANCE ]', centerX, btnY + 40);
  }

  ctx.restore();
  return {returnButtonRect};
}
