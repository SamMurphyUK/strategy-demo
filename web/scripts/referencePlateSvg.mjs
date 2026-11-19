/**
 * Pure vector SVG silhouettes for the 70 Axis & Allies 1940 reference plates.
 *
 * Canvas: 256 x 256 on pure #FFFFFF, zero text/labels/drop shadows.
 * Palette: #2B2B2B primary silhouette, #6E6E6E secondary armor/panel/deck, #A8A8A8 highlights.
 * Padding: >= 14% margin on every side (all geometry inside [36, 220] x [36, 220]).
 * Land & Naval (11 types): strictly side profile facing right, resting on baseline y = 200.
 * Air (3 types): strictly top-down T/cross planform centered at (128, 128), nose pointing right.
 */

const C_DARK = "#2B2B2B";
const C_MID = "#6E6E6E";
const C_LIGHT = "#A8A8A8";
const C_WHITE = "#FFFFFF";

const BASELINE = 200;

function wrapSvg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect x="0" y="0" width="256" height="256" fill="${C_WHITE}"/>
  ${body}
</svg>`;
}

function mirrorY(groupBody) {
  return `${groupBody}\n  <g transform="translate(0 256) scale(1 -1)">${groupBody}</g>`;
}

function wheel(cx, cy, r, spokeCount = 0) {
  const rimR = (r * 0.68).toFixed(1);
  const hubR = (r * 0.28).toFixed(1);
  let spokes = "";
  if (spokeCount > 0) {
    for (let i = 0; i < spokeCount; i += 1) {
      const a = (i * Math.PI * 2) / spokeCount;
      const x2 = (cx + Math.cos(a) * Number(rimR)).toFixed(1);
      const y2 = (cy + Math.sin(a) * Number(rimR)).toFixed(1);
      spokes += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="${C_DARK}" stroke-width="1.3"/>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C_DARK}"/>
      <circle cx="${cx}" cy="${cy}" r="${rimR}" fill="${C_WHITE}"/>
      ${spokes}
      <circle cx="${cx}" cy="${cy}" r="${hubR}" fill="${C_MID}"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C_DARK}"/>
    <circle cx="${cx}" cy="${cy}" r="${rimR}" fill="${C_MID}"/>
    <circle cx="${cx}" cy="${cy}" r="${hubR}" fill="${C_LIGHT}"/>`;
}

function turret(x, y, w, h, barrelLen, barrelH = 3.2, multi = 1, angleDeg = 0) {
  const facingLeft = barrelLen < 0;
  const len = Math.abs(barrelLen);
  const bx = facingLeft ? x + 2 - len : x + w - 2;
  const by = y + h * 0.42;
  let barrels = "";
  for (let i = 0; i < multi; i += 1) {
    const dy = (i - (multi - 1) / 2) * (barrelH * 0.72);
    barrels += `<rect x="${bx}" y="${(by + dy - barrelH / 2).toFixed(1)}" width="${len}" height="${barrelH}" fill="${C_DARK}" rx="0.8"/>`;
  }
  const slope = facingLeft
    ? `M ${x} ${y + h} L ${x + 3} ${y + 1} L ${x + w - 3} ${y} L ${x + w} ${y + h} Z`
    : `M ${x} ${y + h} L ${x + 3} ${y} L ${x + w - 3} ${y + 1} L ${x + w} ${y + h} Z`;
  const inner = `${barrels}
    <path d="${slope}" fill="${C_DARK}"/>
    <rect x="${x + 4}" y="${y + 2}" width="${Math.max(4, w - 10)}" height="${Math.max(2, h * 0.35)}" fill="${C_MID}"/>`;
  if (angleDeg !== 0) {
    return `<g transform="rotate(${angleDeg} ${x + w / 2} ${y + h / 2})">${inner}</g>`;
  }
  return inner;
}

function drawInfantry(faction) {
  // Standing rifleman facing right, boots at y = 200.
  const backpack = faction === "UK"
    ? `<rect x="93" y="88" width="16" height="32" rx="3" fill="${C_MID}"/>
       <rect x="95" y="84" width="12" height="8" rx="2" fill="${C_LIGHT}"/>`
    : `<rect x="92" y="90" width="16" height="34" rx="3" fill="${C_MID}"/>
       <rect x="93" y="85" width="14" height="8" rx="3" fill="${C_LIGHT}"/>`;

  const chestRig = faction === "UK"
    ? `<rect x="116" y="95" width="15" height="16" rx="2" fill="${C_MID}"/>`
    : `<rect x="112" y="120" width="22" height="7" rx="1.5" fill="${C_MID}"/>`;

  let helmet = "";
  if (faction === "GER") {
    // M35 Stahlhelm: pronounced rear neck flare + angled visor
    helmet = `<path d="M 103 69 C 105 51, 134 50, 137 64 L 140 67 L 130 68 L 122 68 L 114 75 L 99 75 Z" fill="${C_DARK}"/>
      <path d="M 108 61 C 113 54, 127 54, 132 61 Z" fill="${C_MID}"/>`;
  } else if (faction === "USSR") {
    // SSh-40: rounded tall dome with smooth flare
    helmet = `<path d="M 103 68 C 104 49, 136 49, 138 66 L 139 68 L 102 70 Z" fill="${C_DARK}"/>
      <path d="M 108 60 C 113 52, 129 52, 133 60 Z" fill="${C_MID}"/>`;
  } else if (faction === "UK") {
    // Brodie dish helmet with wide flat brim front & back
    helmet = `<path d="M 107 63 C 109 51, 132 51, 134 63 Z" fill="${C_DARK}"/>
      <rect x="96" y="62" width="48" height="4.5" rx="2.2" fill="${C_DARK}"/>
      <path d="M 111 60 C 114 54, 127 54, 129 60 Z" fill="${C_MID}"/>`;
  } else if (faction === "US") {
    // M1 helmet: deep rounded pot with slight front peak
    helmet = `<path d="M 105 68 C 105 50, 135 50, 136 65 L 139 67 L 104 68 Z" fill="${C_DARK}"/>
      <path d="M 110 60 C 114 53, 128 53, 132 60 Z" fill="${C_MID}"/>`;
  } else {
    // JAP Type 90 + havelock neck flaps
    helmet = `<path d="M 100 68 L 112 68 L 111 84 L 97 82 Z" fill="${C_MID}"/>
      <line x1="103" y1="70" x2="102" y2="82" stroke="${C_DARK}" stroke-width="1.2"/>
      <line x1="107" y1="70" x2="107" y2="83" stroke="${C_DARK}" stroke-width="1.2"/>
      <path d="M 105 67 C 106 51, 135 51, 136 66 L 138 67 L 104 68 Z" fill="${C_DARK}"/>
      <path d="M 110 60 C 114 54, 127 54, 131 60 Z" fill="${C_MID}"/>`;
  }

  const gaiters = faction === "US" || faction === "UK" || faction === "JAP"
    ? `<polygon points="103,168 117,168 114,189 101,189" fill="${C_MID}"/>
       <polygon points="124,168 139,168 142,189 128,189" fill="${C_MID}"/>`
    : "";

  return wrapSvg(`
    ${backpack}
    <!-- Head & Neck -->
    <circle cx="121" cy="73" r="9.5" fill="${C_MID}"/>
    <rect x="116" y="79" width="9" height="9" fill="${C_MID}"/>
    ${helmet}
    <!-- Rear and Front Legs with clear separation -->
    <polygon points="107,134 121,134 114,191 100,191" fill="${C_DARK}"/>
    <polygon points="120,134 134,134 142,191 128,191" fill="${C_DARK}"/>
    ${gaiters}
    <!-- Boots resting cleanly at y = 200 -->
    <path d="M 99 189 L 114 189 L 117 196 L 122 197 L 122 200 L 99 200 Z" fill="${C_DARK}"/>
    <path d="M 127 189 L 142 189 L 146 196 L 152 197 L 152 200 L 127 200 Z" fill="${C_DARK}"/>
    <!-- Torso -->
    <path d="M 107 87 L 131 87 L 135 137 L 105 137 Z" fill="${C_DARK}"/>
    ${chestRig}
    <!-- Rifle (diagonal upward-right) -->
    <polygon points="94,119 148,88 151,94 98,125" fill="${C_MID}"/>
    <line x1="145" y1="90" x2="188" y2="66" stroke="${C_DARK}" stroke-width="3.6" stroke-linecap="round"/>
    <line x1="184" y1="68" x2="198" y2="60" stroke="${C_MID}" stroke-width="2" stroke-linecap="round"/>
    <!-- Arms gripping rifle -->
    <path d="M 110 92 L 104 113 L 120 115 L 122 108 L 114 106 L 118 94 Z" fill="${C_DARK}"/>
    <path d="M 126 93 L 138 103 L 148 93 L 143 87 L 136 95 L 129 89 Z" fill="${C_LIGHT}"/>
  `);
}

function drawMechInfantry(faction) {
  // Armored half-track facing right, front wheel & rear track resting on y = 200.
  const isGerman = faction === "GER";
  const isUk = faction === "UK";
  const isJap = faction === "JAP";

  const hull = isGerman
    ? `<polygon points="44,148 56,126 154,126 164,142 204,148 210,164 198,176 164,176 156,170 50,170 42,158" fill="${C_DARK}"/>
       <polygon points="56,126 154,126 150,148 48,148" fill="${C_MID}"/>
       <polygon points="62,150 144,150 140,166 56,166" fill="${C_MID}"/>`
    : isUk
      ? `<polygon points="46,132 152,130 162,144 202,148 208,164 196,176 162,176 156,170 48,170" fill="${C_DARK}"/>
         <rect x="52" y="135" width="96" height="16" fill="${C_MID}"/>
         <rect x="50" y="154" width="60" height="14" rx="2" fill="${C_LIGHT}"/>`
      : isJap
        ? `<polygon points="46,130 150,130 164,146 204,150 208,166 196,176 164,176 154,170 48,170" fill="${C_DARK}"/>
           <polygon points="54,132 146,132 142,156 50,156" fill="${C_MID}"/>
           <rect x="78" y="136" width="24" height="22" fill="${C_LIGHT}"/>`
        : `<polygon points="44,130 152,130 162,142 206,144 212,164 202,176 164,176 156,170 46,170" fill="${C_DARK}"/>
           <rect x="50" y="133" width="98" height="20" fill="${C_MID}"/>
           <rect x="158" y="144" width="22" height="12" fill="${C_MID}"/>
           <rect x="208" y="158" width="7" height="10" rx="1" fill="${C_LIGHT}"/>`;

  const cabVisor = `<polygon points="152,132 164,132 168,144 152,144" fill="${C_DARK}"/>
    <rect x="155" y="136" width="9" height="4" fill="${C_LIGHT}"/>`;

  const openRail = `<line x1="56" y1="124" x2="152" y2="124" stroke="${C_DARK}" stroke-width="2.5"/>
    <line x1="72" y1="124" x2="72" y2="131" stroke="${C_DARK}" stroke-width="2"/>
    <line x1="106" y1="124" x2="106" y2="131" stroke="${C_DARK}" stroke-width="2"/>
    <line x1="138" y1="124" x2="138" y2="131" stroke="${C_DARK}" stroke-width="2"/>`;

  const pintleMg = `<line x1="142" y1="126" x2="142" y2="112" stroke="${C_DARK}" stroke-width="2.4"/>
    <rect x="137" y="109" width="22" height="4" fill="${C_DARK}"/>
    <line x1="156" y1="111" x2="176" y2="111" stroke="${C_DARK}" stroke-width="2.2"/>`;

  const frontFender = `<path d="M 166 178 A 22 22 0 0 1 208 178" fill="none" stroke="${C_DARK}" stroke-width="4.5"/>`;

  const track = `<rect x="52" y="172" width="102" height="28" rx="13" fill="${C_DARK}"/>
    <rect x="57" y="176" width="92" height="20" rx="9" fill="${C_LIGHT}"/>
    ${wheel(65, 185, 9)}
    ${wheel(87, 189, 8)}
    ${wheel(107, 189, 8)}
    ${wheel(127, 189, 8)}
    ${wheel(143, 184, 9)}`;

  return wrapSvg(`
    ${hull}
    ${cabVisor}
    ${openRail}
    ${pintleMg}
    ${frontFender}
    ${track}
    ${wheel(188, 183, 17)}
  `);
}

function drawArtillery(faction) {
  // Towed field howitzer facing right, wheel & trail spade on y = 200.
  const hasBrake = faction === "GER" || faction === "USSR" || faction === "UK";
  const hasPlatform = faction === "UK";
  const spoked = faction === "JAP";
  const barrelLen = faction === "USSR" ? 86 : faction === "JAP" ? 76 : 72;
  const barrelW = faction === "US" || faction === "GER" ? 7 : 5.5;

  const trail = `<polygon points="122,171 130,178 52,199 42,194" fill="${C_DARK}"/>
    <polygon points="124,175 130,181 60,198 54,193" fill="${C_MID}"/>
    <polygon points="42,192 54,194 52,200 38,200" fill="${C_DARK}"/>`;

  const shield = faction === "GER"
    ? `<polygon points="122,172 134,122 148,125 140,174" fill="${C_MID}"/>
       <polygon points="125,170 135,127 143,129 136,170" fill="${C_LIGHT}"/>`
    : faction === "USSR"
      ? `<polygon points="122,172 138,134 150,138 138,174" fill="${C_MID}"/>`
      : faction === "UK"
        ? `<polygon points="120,172 130,128 148,128 142,174" fill="${C_MID}"/>
           <rect x="129" y="132" width="12" height="16" fill="${C_LIGHT}"/>`
        : `<polygon points="122,172 134,132 146,134 139,174" fill="${C_MID}"/>`;

  const muzzleBrake = hasBrake
    ? `<rect x="${128 + barrelLen - 2}" y="${-barrelW / 2 - 2}" width="11" height="${barrelW + 4}" rx="1.5" fill="${C_DARK}"/>
       <rect x="${128 + barrelLen + 2}" y="${-barrelW / 2 - 1}" width="3" height="${barrelW + 2}" fill="${C_LIGHT}"/>`
    : "";

  const barrel = `<g transform="translate(132 154) rotate(-27)">
    <rect x="-24" y="-6" width="38" height="13" rx="2" fill="${C_DARK}"/>
    <rect x="-12" y="5" width="44" height="6" rx="2" fill="${C_MID}"/>
    <rect x="8" y="${-barrelW / 2}" width="${barrelLen - 8}" height="${barrelW}" fill="${C_DARK}"/>
    <rect x="10" y="${-barrelW / 2 + 1}" width="${barrelLen * 0.45}" height="2" fill="${C_LIGHT}"/>
    ${muzzleBrake.replace(String(128 + barrelLen - 2), String(barrelLen)).replace(String(128 + barrelLen + 2), String(barrelLen + 4))}
  </g>`;

  const platform = hasPlatform
    ? `<rect x="92" y="194" width="68" height="6" rx="3" fill="${C_MID}"/>
       <line x1="126" y1="184" x2="126" y2="196" stroke="${C_DARK}" stroke-width="3"/>`
    : "";

  return wrapSvg(`
    ${trail}
    ${platform}
    ${barrel}
    ${shield}
    ${wheel(132, 176, 24, spoked ? 10 : 0)}
  `);
}

function drawTank(faction) {
  // Medium tank facing right, tracks resting on y = 200.
  let hull = "";
  let turretSvg = "";
  let trackSvg = "";

  if (faction === "GER") {
    // Panzer IV Ausf. H: box hull, Schürzen skirt panels, boxy turret + cupola, long 75mm + muzzle brake
    hull = `<polygon points="44,168 48,148 168,148 176,162 174,174 44,174" fill="${C_DARK}"/>
      <rect x="54" y="151" width="106" height="18" fill="${C_MID}"/>
      <line x1="88" y1="151" x2="88" y2="169" stroke="${C_DARK}" stroke-width="1.5"/>
      <line x1="124" y1="151" x2="124" y2="169" stroke="${C_DARK}" stroke-width="1.5"/>`;
    turretSvg = `<rect x="76" y="128" width="16" height="14" fill="${C_MID}"/>
      <rect x="94" y="114" width="18" height="8" rx="1.5" fill="${C_DARK}"/>
      <rect x="97" y="116" width="12" height="3" fill="${C_LIGHT}"/>
      <polygon points="88,148 92,122 138,122 146,134 144,148" fill="${C_DARK}"/>
      <rect x="136" y="129" width="14" height="10" rx="2" fill="${C_MID}"/>
      <rect x="148" y="131" width="56" height="5" fill="${C_DARK}"/>
      <rect x="204" y="129" width="11" height="9" rx="1.5" fill="${C_DARK}"/>
      <rect x="208" y="130" width="3" height="7" fill="${C_LIGHT}"/>`;
    trackSvg = `<path d="M 46 184 L 54 170 L 166 170 L 174 184 L 164 200 L 56 200 Z" fill="${C_DARK}"/>
      <rect x="54" y="174" width="112" height="22" rx="8" fill="${C_LIGHT}"/>
      ${wheel(59, 182, 7.5)}
      ${wheel(75, 190, 7)}
      ${wheel(91, 190, 7)}
      ${wheel(107, 190, 7)}
      ${wheel(123, 190, 7)}
      ${wheel(139, 190, 7)}
      ${wheel(155, 190, 7)}
      ${wheel(165, 181, 7.5)}`;
  } else if (faction === "USSR") {
    // T-34/76: steeply sloped glacis, forward cast turret, 5 large Christie road wheels, long 76mm
    hull = `<polygon points="44,170 52,148 148,146 178,166 174,174 44,174" fill="${C_DARK}"/>
      <rect x="54" y="138" width="24" height="10" rx="4" fill="${C_MID}"/>
      <polygon points="146,148 173,166 164,169 140,152" fill="${C_MID}"/>`;
    turretSvg = `<path d="M 94 147 L 98 124 C 106 118, 136 118, 146 128 L 148 147 Z" fill="${C_DARK}"/>
      <rect x="106" y="117" width="16" height="5" rx="1.5" fill="${C_MID}"/>
      <rect x="142" y="129" width="14" height="10" rx="2" fill="${C_MID}"/>
      <rect x="152" y="131" width="62" height="5" fill="${C_DARK}"/>`;
    trackSvg = `<path d="M 44 184 L 52 170 L 168 170 L 176 183 L 165 200 L 55 200 Z" fill="${C_DARK}"/>
      <rect x="52" y="174" width="116" height="22" rx="9" fill="${C_LIGHT}"/>
      ${wheel(58, 182, 7.5)}
      ${wheel(78, 189, 9.5)}
      ${wheel(99, 189, 9.5)}
      ${wheel(120, 189, 9.5)}
      ${wheel(141, 189, 9.5)}
      ${wheel(162, 186, 9)}`;
  } else if (faction === "UK") {
    // Cromwell Mk IV: flat box hull, vertical faceted turret, 5 large wheels
    hull = `<polygon points="42,172 44,148 170,148 176,162 174,174 42,174" fill="${C_DARK}"/>
      <rect x="48" y="152" width="114" height="14" fill="${C_MID}"/>
      <rect x="44" y="138" width="18" height="10" fill="${C_MID}"/>`;
    turretSvg = `<polygon points="82,148 86,122 136,122 142,134 140,148" fill="${C_DARK}"/>
      <rect x="96" y="116" width="15" height="6" fill="${C_MID}"/>
      <rect x="134" y="128" width="12" height="12" fill="${C_MID}"/>
      <rect x="144" y="131" width="60" height="5" fill="${C_DARK}"/>`;
    trackSvg = `<path d="M 42 184 L 50 170 L 168 170 L 176 184 L 166 200 L 52 200 Z" fill="${C_DARK}"/>
      <rect x="50" y="174" width="118" height="22" rx="8" fill="${C_LIGHT}"/>
      ${wheel(56, 183, 7)}
      ${wheel(76, 189, 9.5)}
      ${wheel(97, 189, 9.5)}
      ${wheel(118, 189, 9.5)}
      ${wheel(139, 189, 9.5)}
      ${wheel(160, 187, 9)}`;
  } else if (faction === "US") {
    // M4A1 Sherman: tall rounded cast hull, rounded cast turret, 5-wheel VVSS silhouette
    hull = `<path d="M 46 172 L 48 145 L 146 144 C 162 144, 174 156, 176 172 Z" fill="${C_DARK}"/>
      <path d="M 56 150 L 144 150 C 156 150, 165 158, 166 168 L 56 168 Z" fill="${C_MID}"/>`;
    turretSvg = `<path d="M 88 144 C 86 122, 102 115, 134 118 C 144 122, 146 138, 140 144 Z" fill="${C_DARK}"/>
      <rect x="102" y="111" width="16" height="7" rx="2" fill="${C_MID}"/>
      <rect x="132" y="124" width="16" height="13" rx="3" fill="${C_MID}"/>
      <rect x="145" y="128" width="56" height="5.2" fill="${C_DARK}"/>`;
    trackSvg = `<path d="M 48 184 L 56 170 L 166 170 L 174 184 L 164 200 L 58 200 Z" fill="${C_DARK}"/>
      <rect x="56" y="174" width="110" height="22" rx="8" fill="${C_LIGHT}"/>
      ${wheel(66, 189, 8)}
      ${wheel(87, 189, 8)}
      ${wheel(108, 189, 8)}
      ${wheel(129, 189, 8)}
      ${wheel(150, 189, 8)}
      ${wheel(164, 181, 8)}`;
  } else {
    // JAP Type 97 Chi-Ha Kai: compact stepped hull, bell-crank bogies, tall asymmetric Shinhoto turret
    hull = `<polygon points="48,172 52,150 142,148 168,158 176,172" fill="${C_DARK}"/>
      <polygon points="56,154 138,154 158,162 56,166" fill="${C_MID}"/>`;
    turretSvg = `<polygon points="90,149 94,122 134,122 142,135 138,149" fill="${C_DARK}"/>
      <rect x="104" y="114" width="16" height="8" rx="1.5" fill="${C_MID}"/>
      <rect x="134" y="128" width="12" height="10" fill="${C_MID}"/>
      <rect x="144" y="131" width="54" height="4.5" fill="${C_DARK}"/>`;
    trackSvg = `<path d="M 50 185 L 58 172 L 164 172 L 172 185 L 162 200 L 60 200 Z" fill="${C_DARK}"/>
      <rect x="58" y="176" width="106" height="20" rx="7" fill="${C_LIGHT}"/>
      ${wheel(66, 185, 7)}
      ${wheel(85, 190, 7.5)}
      ${wheel(103, 190, 7.5)}
      ${wheel(121, 190, 7.5)}
      ${wheel(139, 190, 7.5)}
      ${wheel(158, 184, 7.5)}`;
  }

  return wrapSvg(`
    ${hull}
    ${turretSvg}
    ${trackSvg}
  `);
}

function drawAaa(faction) {
  // Anti-aircraft gun on cruciform outrigger platform, steep 55 deg barrel pointing right-up, baseline y = 200.
  const hasShield = faction === "GER" || faction === "USSR";
  const base = `<rect x="52" y="191" width="144" height="6" rx="2" fill="${C_DARK}"/>
    <rect x="46" y="195" width="18" height="5" fill="${C_MID}"/>
    <rect x="184" y="195" width="18" height="5" fill="${C_MID}"/>
    <rect x="108" y="195" width="32" height="5" fill="${C_DARK}"/>
    <polygon points="98,191 108,162 140,162 150,191" fill="${C_DARK}"/>
    <rect x="112" y="166" width="24" height="22" fill="${C_MID}"/>`;

  const carriage = `<polygon points="106,162 114,138 134,138 142,162" fill="${C_DARK}"/>
    <circle cx="124" cy="146" r="10" fill="${C_MID}"/>
    <circle cx="124" cy="146" r="5" fill="${C_LIGHT}"/>`;

  // Pivot at (124, 144), 55 deg elevation -> rotate(-55)
  const gun = `<g transform="translate(124 144) rotate(-55)">
    <rect x="-26" y="-7" width="44" height="14" rx="2" fill="${C_DARK}"/>
    <rect x="-14" y="6" width="46" height="7" rx="2" fill="${C_MID}"/>
    <rect x="-10" y="-12" width="34" height="6" rx="2" fill="${C_MID}"/>
    <rect x="16" y="-3.2" width="108" height="6" fill="${C_DARK}"/>
    <rect x="20" y="-2" width="46" height="2" fill="${C_LIGHT}"/>
    <rect x="118" y="-4.5" width="8" height="8.5" rx="1" fill="${C_DARK}"/>
  </g>`;

  const shield = hasShield
    ? faction === "GER"
      ? `<polygon points="122,162 138,118 152,122 138,164" fill="${C_MID}"/>
         <polygon points="126,158 140,122 147,125 135,160" fill="${C_LIGHT}"/>`
      : `<polygon points="122,162 134,126 146,130 136,164" fill="${C_MID}"/>`
    : `<circle cx="110" cy="150" r="6" fill="none" stroke="${C_DARK}" stroke-width="2"/>`;

  return wrapSvg(`
    ${base}
    ${carriage}
    ${gun}
    ${shield}
  `);
}

function drawSubmarine(faction) {
  // Low-freeboard cigar hull facing right, keel on y = 200.
  const hasHangar = faction === "JAP";
  const hasBulbBow = faction === "UK";
  const saddle = faction === "GER"
    ? `<ellipse cx="128" cy="186" rx="46" ry="5.5" fill="${C_MID}"/>`
    : "";

  const bow = hasBulbBow
    ? `L 210 174 C 216 174, 220 180, 220 188 L 214 200`
    : `L 218 182 L 220 188 L 210 200`;

  const hull = `<path d="M 38 192 L 46 181 L 204 181 ${bow} L 46 200 L 38 194 Z" fill="${C_DARK}"/>
    <rect x="52" y="181" width="152" height="6" fill="${C_MID}"/>
    <rect x="36" y="189" width="10" height="8" rx="1" fill="${C_MID}"/>
    ${saddle}`;

  const tower = faction === "GER"
    ? `<polygon points="104,181 108,156 134,156 138,181" fill="${C_DARK}"/>
       <rect x="98" y="167" width="12" height="14" fill="${C_MID}"/>
       <rect x="112" y="160" width="18" height="6" fill="${C_LIGHT}"/>`
    : faction === "JAP"
      ? `<polygon points="100,181 105,152 136,152 142,181" fill="${C_DARK}"/>
         <rect x="138" y="166" width="28" height="15" rx="3" fill="${C_MID}"/>
         <line x1="166" y1="176" x2="196" y2="176" stroke="${C_DARK}" stroke-width="2.5"/>`
      : `<polygon points="106,181 112,156 136,156 142,181" fill="${C_DARK}"/>
         <rect x="115" y="161" width="18" height="6" fill="${C_LIGHT}"/>`;

  const masts = `<line x1="118" y1="156" x2="118" y2="124" stroke="${C_DARK}" stroke-width="2.4"/>
    <line x1="126" y1="156" x2="126" y2="132" stroke="${C_DARK}" stroke-width="2"/>
    <line x1="118" y1="125" x2="123" y2="125" stroke="${C_DARK}" stroke-width="2.2"/>`;

  const deckGun = hasHangar
    ? `<rect x="82" y="175" width="12" height="6" fill="${C_DARK}"/>
       <line x1="84" y1="177" x2="70" y2="175" stroke="${C_DARK}" stroke-width="2.4"/>`
    : `<rect x="150" y="174" width="12" height="7" fill="${C_DARK}"/>
       <line x1="160" y1="176" x2="175" y2="174" stroke="${C_DARK}" stroke-width="2.5"/>`;

  return wrapSvg(`
    ${masts}
    ${deckGun}
    ${tower}
    ${hull}
  `);
}

function drawTransport(faction) {
  // Merchant troopship with forecastle, poop, central bridgehouse, funnel, twin derrick masts (no main turrets), keel on y = 200.
  const bridgeX = faction === "JAP" ? 114 : 106;
  const funnelH = faction === "USSR" ? 26 : 22;

  const hull = `<path d="M 38 172 L 66 172 L 70 180 L 184 180 L 190 170 L 218 170 L 208 200 L 44 200 Z" fill="${C_DARK}"/>
    <rect x="68" y="180" width="118" height="6" fill="${C_MID}"/>`;

  const bridge = `<rect x="${bridgeX}" y="152" width="44" height="28" fill="${C_MID}"/>
    <rect x="${bridgeX + 4}" y="142" width="32" height="12" fill="${C_LIGHT}"/>
    <rect x="${bridgeX + 8}" y="146" width="22" height="4" fill="${C_DARK}"/>
    <rect x="${bridgeX - 8}" y="160" width="10" height="7" rx="3" fill="${C_LIGHT}"/>`;

  const funnel = `<polygon points="${bridgeX + 12},142 ${bridgeX + 15},${142 - funnelH} ${bridgeX + 27},${142 - funnelH} ${bridgeX + 26},142" fill="${C_DARK}"/>
    <rect x="${bridgeX + 15}" y="${142 - funnelH}" width="12" height="4" fill="${C_MID}"/>`;

  const derricks = `<!-- Aft cargo mast & booms -->
    <line x1="84" y1="180" x2="84" y2="106" stroke="${C_DARK}" stroke-width="3.2"/>
    <line x1="84" y1="168" x2="62" y2="132" stroke="${C_MID}" stroke-width="2.4"/>
    <line x1="84" y1="168" x2="104" y2="132" stroke="${C_MID}" stroke-width="2.4"/>
    <line x1="84" y1="112" x2="62" y2="132" stroke="${C_LIGHT}" stroke-width="1.2"/>
    <line x1="84" y1="112" x2="104" y2="132" stroke="${C_LIGHT}" stroke-width="1.2"/>
    <!-- Fore cargo mast & booms -->
    <line x1="170" y1="180" x2="170" y2="102" stroke="${C_DARK}" stroke-width="3.2"/>
    <line x1="170" y1="168" x2="148" y2="130" stroke="${C_MID}" stroke-width="2.4"/>
    <line x1="170" y1="168" x2="194" y2="130" stroke="${C_MID}" stroke-width="2.4"/>
    <line x1="170" y1="108" x2="148" y2="130" stroke="${C_LIGHT}" stroke-width="1.2"/>
    <line x1="170" y1="108" x2="194" y2="130" stroke="${C_LIGHT}" stroke-width="1.2"/>`;

  return wrapSvg(`
    ${derricks}
    ${funnel}
    ${bridge}
    ${hull}
  `);
}

function drawDestroyer(faction) {
  // Sleek low-freeboard warship hull, raked bow, twin funnels, compact bridge, fore/aft guns, keel on y = 200.
  const rake = faction === "JAP" || faction === "GER" ? -8 : -3;
  const hull = `<path d="M 40 187 L 180 187 L 188 180 L 218 178 L 205 200 L 44 200 Z" fill="${C_DARK}"/>
    <rect x="46" y="188" width="150" height="3.5" fill="${C_MID}"/>`;

  const bridge = `<polygon points="146,187 150,156 172,156 176,187" fill="${C_MID}"/>
    <rect x="152" y="148" width="16" height="9" fill="${C_DARK}"/>
    <line x1="156" y1="148" x2="152" y2="118" stroke="${C_DARK}" stroke-width="2.8"/>
    <line x1="145" y1="130" x2="162" y2="130" stroke="${C_DARK}" stroke-width="2"/>`;

  const funnels = `<g transform="skewX(${rake})">
      <rect x="118" y="154" width="11" height="33" fill="${C_DARK}"/>
      <rect x="118" y="154" width="11" height="5" fill="${C_MID}"/>
      <rect x="92" y="158" width="10" height="29" fill="${C_DARK}"/>
      <rect x="92" y="158" width="10" height="5" fill="${C_MID}"/>
    </g>
    <rect x="82" y="176" width="12" height="11" fill="${C_MID}"/>
    <line x1="88" y1="176" x2="86" y2="136" stroke="${C_DARK}" stroke-width="2"/>`;

  const guns = faction === "US"
    ? `<rect x="176" y="181" width="12" height="7" fill="${C_MID}"/>
       <rect x="65" y="181" width="12" height="7" fill="${C_MID}"/>
       ${turret(176, 173, 12, 8, 13, 2.4)}
       ${turret(192, 173, 11, 8, 12, 2.4)}
       ${turret(50, 179, 11, 8, -12, 2.4)}
       ${turret(66, 173, 11, 8, -12, 2.4)}`
    : `<rect x="70" y="180" width="13" height="8" fill="${C_MID}"/>
       ${turret(180, 173, 15, 9, 15, 2.6, 2)}
       ${turret(52, 178, 14, 9, -14, 2.6, 2)}
       ${turret(70, 172, 13, 8, -13, 2.4, 2)}`;

  return wrapSvg(`
    ${bridge}
    ${funnels}
    ${guns}
    ${hull}
  `);
}

function drawCruiser(faction) {
  // Longer warship hull, taller bridge tower, floatplane catapult amidships, 3+ superfiring turrets, keel on y = 200.
  const hull = `<path d="M 36 180 L 182 180 L 190 172 L 220 169 L 208 200 L 42 200 Z" fill="${C_DARK}"/>
    <rect x="44" y="181" width="154" height="6" fill="${C_MID}"/>`;

  const bridge = faction === "JAP"
    ? `<polygon points="140,180 144,132 168,132 174,180" fill="${C_DARK}"/>
       <rect x="147" y="122" width="18" height="11" fill="${C_MID}"/>
       <rect x="151" y="114" width="10" height="8" fill="${C_DARK}"/>
       <line x1="156" y1="114" x2="156" y2="96" stroke="${C_DARK}" stroke-width="2.6"/>`
    : `<polygon points="142,180 146,142 168,142 174,180" fill="${C_MID}"/>
       <rect x="148" y="130" width="16" height="12" fill="${C_DARK}"/>
       <line x1="156" y1="130" x2="152" y2="102" stroke="${C_DARK}" stroke-width="2.6"/>
       <line x1="144" y1="114" x2="164" y2="114" stroke="${C_DARK}" stroke-width="2"/>`;

  let funnels = "";
  if (faction === "GER") {
    funnels = `<polygon points="116,180 112,138 128,138 130,180" fill="${C_DARK}"/>
      <rect x="112" y="138" width="16" height="5" fill="${C_MID}"/>`;
  } else if (faction === "UK") {
    funnels = `<rect x="124" y="142" width="10" height="38" fill="${C_DARK}"/>
      <rect x="108" y="144" width="10" height="36" fill="${C_DARK}"/>
      <rect x="92" y="146" width="10" height="34" fill="${C_DARK}"/>`;
  } else {
    funnels = `<rect x="122" y="142" width="12" height="38" fill="${C_DARK}"/>
      <rect x="96" y="146" width="11" height="34" fill="${C_DARK}"/>
      <rect x="122" y="142" width="12" height="5" fill="${C_MID}"/>
      <rect x="96" y="146" width="11" height="5" fill="${C_MID}"/>`;
  }

  // Floatplane catapult & crane amidships
  const catapult = `<rect x="82" y="164" width="24" height="4" fill="${C_LIGHT}"/>
    <polygon points="88,164 96,158 104,164" fill="${C_MID}"/>
    <line x1="78" y1="180" x2="78" y2="124" stroke="${C_DARK}" stroke-width="2.4"/>`;

  const guns = `<rect x="167" y="167" width="18" height="14" fill="${C_MID}"/>
    ${turret(184, 166, 16, 10, 18, 2.8, 2)}
    ${turret(168, 158, 16, 10, 18, 2.8, 2)}
    ${turret(54, 169, 16, 10, -18, 2.8, 2)}`;

  return wrapSvg(`
    ${catapult}
    ${bridge}
    ${funnels}
    ${guns}
    ${hull}
  `);
}

function drawCarrier(faction) {
  // Continuous flat flight deck spanning bow to stern with sponsons + asymmetric starboard island, keel on y = 200.
  const isJap = faction === "JAP";
  const isUk = faction === "UK";
  const islandX = isJap ? 142 : 122;

  const hull = isUk
    ? `<path d="M 42 158 L 214 158 L 204 200 L 48 200 Z" fill="${C_DARK}"/>
       <rect x="56" y="162" width="144" height="16" fill="${C_MID}"/>`
    : `<path d="M 44 160 L 208 160 L 200 200 L 50 200 Z" fill="${C_DARK}"/>
       <rect x="58" y="164" width="136" height="14" fill="${C_MID}"/>
       <!-- Overhang deck struts bow & stern -->
       <line x1="38" y1="158" x2="50" y2="178" stroke="${C_MID}" stroke-width="2.5"/>
       <line x1="216" y1="158" x2="202" y2="178" stroke="${C_MID}" stroke-width="2.5"/>`;

  // Continuous flat flight deck
  const deck = `<rect x="36" y="151" width="184" height="8" rx="1" fill="${C_DARK}"/>
    <rect x="40" y="152" width="176" height="3" fill="${C_LIGHT}"/>
    <rect x="74" y="159" width="14" height="6" fill="${C_MID}"/>
    <rect x="172" y="159" width="14" height="6" fill="${C_MID}"/>`;

  const island = isJap
    ? `<rect x="${islandX}" y="135" width="22" height="16" fill="${C_DARK}"/>
       <rect x="${islandX + 3}" y="128" width="14" height="7" fill="${C_MID}"/>
       <line x1="${islandX + 10}" y1="128" x2="${islandX + 10}" y2="112" stroke="${C_DARK}" stroke-width="2.4"/>`
    : `<rect x="${islandX}" y="128" width="34" height="23" fill="${C_MID}"/>
       <rect x="${islandX + 18}" y="118" width="12" height="12" fill="${C_DARK}"/>
       <polygon points="${islandX + 4},151 ${islandX + 6},114 ${islandX + 17},114 ${islandX + 18},151" fill="${C_DARK}"/>
       <rect x="${islandX + 6}" y="114" width="11" height="4" fill="${C_MID}"/>
       <line x1="${islandX + 24}" y1="118" x2="${islandX + 22}" y2="104" stroke="${C_DARK}" stroke-width="2.4"/>`;

  const sideFunnels = isJap
    ? `<path d="M 116 159 L 116 172 L 104 174" fill="none" stroke="${C_LIGHT}" stroke-width="6"/>
       <path d="M 130 159 L 130 171 L 119 173" fill="none" stroke="${C_LIGHT}" stroke-width="5.5"/>`
    : "";

  return wrapSvg(`
    ${island}
    ${hull}
    ${sideFunnels}
    ${deck}
  `);
}

function drawBattleship(faction) {
  // Heavy deep-draft hull, massive armored tower/pagoda mast, 3-4 main-battery turrets, keel on y = 200.
  const hull = `<path d="M 36 174 L 184 174 L 194 166 L 220 162 L 208 200 L 42 200 Z" fill="${C_DARK}"/>
    <rect x="64" y="176" width="116" height="12" fill="${C_MID}"/>
    <rect x="44" y="174" width="146" height="4" fill="${C_LIGHT}"/>`;

  let superstructure = "";
  if (faction === "JAP") {
    // Yamato towering tiered pagoda mast + large raked funnel
    superstructure = `<rect x="132" y="148" width="26" height="26" fill="${C_DARK}"/>
      <rect x="135" y="132" width="22" height="16" fill="${C_MID}"/>
      <rect x="137" y="116" width="18" height="16" fill="${C_DARK}"/>
      <rect x="139" y="102" width="14" height="14" fill="${C_MID}"/>
      <rect x="142" y="90" width="8" height="12" fill="${C_DARK}"/>
      <line x1="146" y1="90" x2="146" y2="76" stroke="${C_DARK}" stroke-width="2.6"/>
      <polygon points="104,174 114,126 128,126 120,174" fill="${C_DARK}"/>
      <rect x="114" y="126" width="14" height="5" fill="${C_MID}"/>`;
  } else if (faction === "UK") {
    // King George V boxy Queen Anne's Mansions bridge + 2 vertical funnels
    superstructure = `<rect x="136" y="130" width="28" height="44" fill="${C_MID}"/>
      <rect x="140" y="120" width="20" height="12" fill="${C_DARK}"/>
      <line x1="148" y1="120" x2="148" y2="96" stroke="${C_DARK}" stroke-width="2.6"/>
      <rect x="114" y="132" width="12" height="42" fill="${C_DARK}"/>
      <rect x="92" y="136" width="11" height="38" fill="${C_DARK}"/>
      <line x1="84" y1="174" x2="84" y2="108" stroke="${C_DARK}" stroke-width="2.4"/>`;
  } else if (faction === "GER") {
    // Bismarck heavy tower bridge + single large funnel
    superstructure = `<polygon points="134,174 138,126 160,126 164,174" fill="${C_MID}"/>
      <rect x="142" y="114" width="14" height="12" fill="${C_DARK}"/>
      <line x1="148" y1="114" x2="144" y2="92" stroke="${C_DARK}" stroke-width="2.6"/>
      <polygon points="108,174 112,130 128,130 126,174" fill="${C_DARK}"/>
      <rect x="112" y="130" width="16" height="5" fill="${C_MID}"/>
      <line x1="86" y1="174" x2="86" y2="110" stroke="${C_DARK}" stroke-width="2.4"/>`;
  } else {
    // US Iowa / USSR Sovetsky Soyuz armored tower + two funnels
    superstructure = `<polygon points="134,174 140,124 162,124 166,174" fill="${C_MID}"/>
      <rect x="144" y="112" width="14" height="12" fill="${C_DARK}"/>
      <line x1="150" y1="112" x2="148" y2="88" stroke="${C_DARK}" stroke-width="2.6"/>
      <polygon points="116,174 120,130 132,130 130,174" fill="${C_DARK}"/>
      <polygon points="92,174 96,136 108,136 106,174" fill="${C_DARK}"/>
      <line x1="84" y1="174" x2="82" y2="106" stroke="${C_DARK}" stroke-width="2.4"/>`;
  }

  const turrets = faction === "GER"
    ? `<rect x="163" y="161" width="19" height="14" fill="${C_MID}"/>
       <rect x="72" y="166" width="19" height="9" fill="${C_MID}"/>
       ${turret(182, 160, 17, 11, 18, 3.2, 2)}
       ${turret(164, 151, 17, 11, 18, 3.2, 2)}
       ${turret(73, 156, 17, 11, -18, 3.2, 2)}
       ${turret(54, 163, 17, 11, -18, 3.2, 2)}`
    : `<rect x="161" y="159" width="20" height="16" fill="${C_MID}"/>
       ${turret(182, 158, 18, 12, 20, 3.2, 3)}
       ${turret(162, 148, 18, 12, 20, 3.2, 3)}
       ${turret(56, 162, 18, 12, -20, 3.2, 3)}`;

  return wrapSvg(`
    ${superstructure}
    ${turrets}
    ${hull}
  `);
}

// =====================================================================
// AIR UNITS: Top-down T/cross planform, nose pointing right, center (128, 128).
// Bounds: x in [36, 220], y in [36, 220].
// =====================================================================

function drawFighter(faction) {
  const halfSpan = faction === "JAP" ? 86 : 82;
  const isElliptical = faction === "UK";
  const isRadial = faction === "JAP";

  // Top half of wing (mirrored across y = 128)
  let wingHalf = "";
  if (isElliptical) {
    // Spitfire elliptical wing
    wingHalf = `<path d="M 164 122 C 166 80, 154 44, 142 44 C 128 44, 122 86, 122 122 Z" fill="${C_DARK}"/>
      <path d="M 158 118 C 158 84, 150 56, 142 56 C 134 56, 130 88, 130 118 Z" fill="${C_MID}"/>`;
  } else if (faction === "GER") {
    // Bf 109G straight tapered trapezoidal wing with squared tip
    wingHalf = `<polygon points="165,122 158,46 144,46 126,122" fill="${C_DARK}"/>
      <polygon points="159,118 153,54 146,54 134,118" fill="${C_MID}"/>`;
  } else if (faction === "US") {
    // P-51D laminar wing with cranked inner fillet & squared tip
    wingHalf = `<polygon points="170,122 158,108 152,46 135,46 122,122" fill="${C_DARK}"/>
      <polygon points="158,118 149,54 138,54 131,118" fill="${C_MID}"/>`;
  } else if (faction === "USSR") {
    // Yak-3 compact tapered wing with curved trailing edge & rounded tip
    wingHalf = `<path d="M 165 122 L 156 49 C 152 43, 144 43, 140 49 L 124 122 Z" fill="${C_DARK}"/>
      <polygon points="158,118 152,55 143,55 133,118" fill="${C_MID}"/>`;
  } else {
    // A6M2 Zero long graceful tapered wing with rounded tip
    wingHalf = `<path d="M 168 122 L 159 44 C 155 39, 147 39, 143 45 L 122 122 Z" fill="${C_DARK}"/>
      <polygon points="161,118 154,50 146,50 132,118" fill="${C_MID}"/>`;
  }

  const tailHalf = isElliptical
    ? `<path d="M 68 125 C 68 106, 62 96, 54 96 C 46 96, 44 110, 46 125 Z" fill="${C_DARK}"/>`
    : `<polygon points="68,125 60,96 48,96 46,125" fill="${C_DARK}"/>`;

  const nose = isRadial
    ? `<path d="M 176 119 L 204 121 C 209 123, 210 133, 204 135 L 176 137 Z" fill="${C_DARK}"/>
       <ellipse cx="209" cy="128" rx="3.5" ry="4" fill="${C_MID}"/>`
    : `<path d="M 176 121 L 205 124 L 214 128 L 205 132 L 176 135 Z" fill="${C_DARK}"/>`;

  const prop = `<line x1="212" y1="108" x2="212" y2="148" stroke="${C_MID}" stroke-width="2.2" stroke-linecap="round"/>`;
  const fuselage = `<path d="M 42 128 L 54 123 L 182 120 L 182 136 L 54 133 Z" fill="${C_DARK}"/>
    <rect x="116" y="123.5" width="28" height="9" rx="4.5" fill="${C_LIGHT}"/>
    <line x1="56" y1="128" x2="108" y2="128" stroke="${C_MID}" stroke-width="1.5"/>`;

  return wrapSvg(`
    ${mirrorY(wingHalf)}
    ${mirrorY(tailHalf)}
    ${prop}
    ${fuselage}
    ${nose}
    <!-- Vertical fin spine -->
    <rect x="44" y="126.8" width="22" height="2.4" rx="1" fill="${C_LIGHT}"/>
  `);
}

function drawTacBomber(faction) {
  // Dive-bomber / attack aircraft viewed from above, broader chord wings, dive brakes, rear greenhouse.
  let wingHalf = "";
  if (faction === "GER") {
    // Ju 87 Stuka: broad rectangular-to-tapered gull wing + dive brake bars
    wingHalf = `<polygon points="172,120 166,42 142,42 120,120" fill="${C_DARK}"/>
      <polygon points="166,116 161,48 145,48 131,116" fill="${C_MID}"/>
      <rect x="150" y="64" width="4" height="36" fill="${C_LIGHT}"/>`;
  } else if (faction === "USSR") {
    // Il-2 Sturmovik: broad straight leading edge, swept trailing edge, wing-root cannon pods
    wingHalf = `<polygon points="172,120 166,42 142,44 118,120" fill="${C_DARK}"/>
      <polygon points="164,116 160,50 144,52 132,116" fill="${C_MID}"/>
      <rect x="166" y="100" width="16" height="4.5" rx="1" fill="${C_DARK}"/>`;
  } else if (faction === "UK") {
    // Fairey Barracuda: broad square-tipped wing with prominent Youngman dive-brake flaps
    wingHalf = `<polygon points="170,120 164,42 136,42 120,120" fill="${C_DARK}"/>
      <polygon points="163,115 159,48 140,48 130,115" fill="${C_MID}"/>
      <rect x="128" y="60" width="6" height="44" fill="${C_LIGHT}"/>`;
  } else {
    // US SBD Dauntless / JAP D3A Val: broad elliptical/rounded-tip dive bomber wing + dive brakes
    wingHalf = `<path d="M 172 120 L 164 46 C 158 38, 140 38, 134 46 L 116 120 Z" fill="${C_DARK}"/>
      <path d="M 164 115 L 158 52 C 154 46, 142 46, 138 52 L 128 115 Z" fill="${C_MID}"/>
      <line x1="133" y1="62" x2="128" y2="108" stroke="${C_LIGHT}" stroke-width="3" stroke-dasharray="5 3"/>`;
  }

  const tailHalf = `<polygon points="70,124 62,90 46,90 44,124" fill="${C_DARK}"/>`;
  const radial = faction === "US" || faction === "JAP";
  const nose = radial
    ? `<path d="M 178 117 L 204 119 C 209 122, 209 134, 204 137 L 178 139 Z" fill="${C_DARK}"/>
       <ellipse cx="210" cy="128" rx="3.5" ry="4" fill="${C_MID}"/>`
    : `<path d="M 178 118 L 204 122 L 214 128 L 204 134 L 178 138 Z" fill="${C_DARK}"/>`;

  const prop = `<line x1="212" y1="105" x2="212" y2="151" stroke="${C_MID}" stroke-width="2.4" stroke-linecap="round"/>`;
  const fuselage = `<path d="M 40 128 L 54 121 L 182 118 L 182 138 L 54 135 Z" fill="${C_DARK}"/>
    <!-- Rear gunner greenhouse canopy -->
    <rect x="104" y="122" width="46" height="12" rx="5" fill="${C_LIGHT}"/>
    <line x1="118" y1="122" x2="118" y2="134" stroke="${C_DARK}" stroke-width="1.6"/>
    <line x1="132" y1="122" x2="132" y2="134" stroke="${C_DARK}" stroke-width="1.6"/>
    <rect x="44" y="126.5" width="24" height="3" fill="${C_MID}"/>`;

  return wrapSvg(`
    ${mirrorY(wingHalf)}
    ${mirrorY(tailHalf)}
    ${prop}
    ${fuselage}
    ${nose}
  `);
}

function drawBomber(faction) {
  // Heavy multi-engine strategic bomber viewed from above, nose right, centered at (128, 128).
  const isFourEngine = faction === "UK" || faction === "US";
  const isTwinTail = faction === "UK";

  let wingHalf = "";
  if (faction === "GER") {
    // He 111 broad elliptical-trailing-edge wing
    wingHalf = `<path d="M 172 119 L 160 40 C 152 36, 138 38, 132 48 L 112 119 Z" fill="${C_DARK}"/>
      <polygon points="163,115 155,48 138,52 125,115" fill="${C_MID}"/>`;
  } else if (faction === "USSR") {
    // Il-4 swept leading edge wing
    wingHalf = `<polygon points="170,119 152,38 134,40 116,119" fill="${C_DARK}"/>
      <polygon points="161,115 148,46 138,48 128,115" fill="${C_MID}"/>`;
  } else {
    // UK Lancaster / US B-17 / JAP G4M wide high-aspect tapered wing
    wingHalf = `<polygon points="172,119 158,36 138,36 116,119" fill="${C_DARK}"/>
      <polygon points="163,115 154,44 142,44 128,115" fill="${C_MID}"/>`;
  }

  const nacelle = (x, y) => `<rect x="${x}" y="${y - 5.5}" width="24" height="11" rx="3" fill="${C_DARK}"/>
    <rect x="${x + 4}" y="${y - 3}" width="12" height="6" rx="1.5" fill="${C_MID}"/>
    <line x1="${x + 25}" y1="${y - 11}" x2="${x + 25}" y2="${y + 11}" stroke="${C_MID}" stroke-width="2" stroke-linecap="round"/>`;

  const enginesHalf = isFourEngine
    ? `${nacelle(158, 92)}${nacelle(148, 66)}`
    : `${nacelle(156, 86)}`;

  const tailHalf = isTwinTail
    ? `<polygon points="66,123 58,84 42,84 42,123" fill="${C_DARK}"/>
       <rect x="40" y="81" width="22" height="4.5" rx="1" fill="${C_MID}"/>`
    : `<polygon points="72,123 60,82 43,82 41,123" fill="${C_DARK}"/>`;

  const fuselage = faction === "JAP"
    ? `<path d="M 38 128 L 54 122 L 194 117 C 212 119, 218 124, 218 128 C 218 132, 212 137, 194 139 L 54 134 Z" fill="${C_DARK}"/>`
    : `<path d="M 38 128 L 52 121 L 198 119 C 212 121, 218 124, 218 128 C 218 132, 212 135, 198 137 L 52 135 Z" fill="${C_DARK}"/>`;

  const glazing = `<ellipse cx="204" cy="128" rx="9" ry="5.5" fill="${C_LIGHT}"/>
    <rect x="164" y="122" width="22" height="12" rx="4" fill="${C_LIGHT}"/>
    <circle cx="136" cy="128" r="5" fill="${C_MID}"/>
    <circle cx="136" cy="128" r="3" fill="${C_LIGHT}"/>
    ${isTwinTail ? "" : `<rect x="44" y="126.5" width="24" height="3" fill="${C_MID}"/>`}`;

  return wrapSvg(`
    ${mirrorY(wingHalf)}
    ${mirrorY(tailHalf)}
    ${fuselage}
    ${mirrorY(enginesHalf)}
    ${glazing}
  `);
}

const RENDERERS = {
  infantry: drawInfantry,
  mech_infantry: drawMechInfantry,
  artillery: drawArtillery,
  tank: drawTank,
  aaa: drawAaa,
  submarine: drawSubmarine,
  transport: drawTransport,
  destroyer: drawDestroyer,
  cruiser: drawCruiser,
  carrier: drawCarrier,
  battleship: drawBattleship,
  fighter: drawFighter,
  tac_bomber: drawTacBomber,
  bomber: drawBomber,
};

export function renderPlateSvg(factionId, unitTypeId) {
  const draw = RENDERERS[unitTypeId];
  if (!draw) {
    throw new Error(`No plate renderer for unitTypeId "${unitTypeId}"`);
  }
  return draw(factionId);
}
