'use client';

import { useEffect, useRef } from 'react';

// Boet — the Ask Boet mascot (safari ranger, from the Claude Design
// "Safari Helper" handoff, 2026-07-20). One inline 260×300 SVG with 10
// self-contained activity scenes; the launcher drives which one shows via
// `scene` and wanders him between them. Boet is always subtly alive —
// blink + breathing are CSS, and his eyes follow the cursor when `alive`.
//
// Ported faithfully: the SVG is the design's, injected verbatim (so the
// hand-tuned geometry + per-element animation timings stay pixel-exact),
// with the `gg-*` keyframe names renamed `boet-*` (globals.css) so they
// can't clash with other `gg-` rules, and the ids namespaced `boet-*`.
// Scene switching mirrors the design's apply(): toggle `.sc` display, swap
// the rig animation, hide the legs while driving. Reduced motion stills
// everything but the blink (globals.css) and the launcher keeps him idle.
//
// ALWAYS-LOADED (imported by the launcher) — keep tiny + react-only.

export type BoetScene =
  | 'idle'
  | 'wave'
  | 'lookout'
  | 'campfire'
  | 'tent'
  // NO 'shooting' SCENE. It drew Boet firing a scoped long gun — wooden barrel,
  // front sight, shoulder stock, an animated muzzle flash and a target taking
  // hits — and the launcher rotated it in at random on EVERY page, signed out
  // included. The file already carried the house rule "never firearm jokes";
  // the artwork was simply never brought in line with it. Do not add it back.
  | 'fishing'
  | 'camp-tool'
  | 'map'
  | 'drive';

// Legacy mood prop — the in-chat typing bubble + panel header avatars drive
// this (not a fixed `scene`). Kept 1:1 with old Sparkie's chat behaviour:
// `think` while a reply streams, a brief `happy` pulse when it lands. Mapped
// to the Boet scene that reads the same (see the mood→scene table below).
export type SparkieMood = 'idle' | 'think' | 'happy';

// Per-scene rig (body/head/hat) motion. Everything else stays on the
// default breathing bob. Values are the design's, verbatim.
const RIGS: Partial<Record<BoetScene, string>> = {
  lookout:
    'animation:boet-pan 4.2s ease-in-out infinite alternate;transform-origin:130px 292px',
  drive: 'animation:boet-drive .45s ease-in-out infinite',
};
const DEFAULT_RIG = 'animation:boet-bob 3.4s ease-in-out infinite';

// The design's SVG, injected verbatim. Contains no backticks or ${} so it
// sits safely in this template literal; kept as raw HTML (not JSX) so the
// hyphenated SVG attributes + inline animation styles transfer unchanged.
const SVG_INNER = `<defs>
        <radialGradient id="boetSkin" cx="45%" cy="38%" r="75%"><stop offset="0" stop-color="#f2c493"></stop><stop offset="1" stop-color="#d99f6d"></stop></radialGradient>
        <linearGradient id="boetShirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfba8d"></stop><stop offset="1" stop-color="#ad9668"></stop></linearGradient>
        <linearGradient id="boetVest" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d6647"></stop><stop offset="1" stop-color="#524d36"></stop></linearGradient>
        <linearGradient id="boetHat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#98865e"></stop><stop offset="1" stop-color="#776744"></stop></linearGradient>
      </defs>
      <ellipse cx="130" cy="292" rx="62" ry="8" fill="#000" opacity="0.35"></ellipse>
      <g class="sc sc-campfire" style="display:none">
        <g>
          <ellipse cx="52" cy="264" rx="36" ry="16" fill="#e8862d" style="animation:boet-glow 1.2s ease-in-out infinite"></ellipse>
          <rect x="34" y="262" width="36" height="7" rx="3" fill="#6b4a2e" transform="rotate(12 52 266)"></rect>
          <rect x="34" y="262" width="36" height="7" rx="3" fill="#5d3f26" transform="rotate(-14 52 266)"></rect>
          <path d="M52 222 q14 16 10 30 q-2 12 -10 14 q-8 -2 -10 -14 q-4 -14 10 -30 z" fill="#e8862d" style="animation:boet-flame .55s ease-in-out infinite;transform-origin:52px 266px"></path>
          <path d="M52 234 q9 12 6 21 q-1 8 -6 9 q-5 -1 -6 -9 q-3 -9 6 -21 z" fill="#f2a93b" style="animation:boet-flame .42s ease-in-out infinite;transform-origin:52px 266px"></path>
          <path d="M52 246 q5 7 3 12 q-1 5 -3 6 q-2 -1 -3 -6 q-2 -5 3 -12 z" fill="#f7d154" style="animation:boet-flame .5s ease-in-out infinite;transform-origin:52px 266px"></path>
          <circle cx="44" cy="244" r="1.6" fill="#f7c96a" style="animation:boet-spark 1.4s linear infinite .2s"></circle>
          <circle cx="56" cy="240" r="1.6" fill="#f7c96a" style="animation:boet-spark 1.8s linear infinite .6s"></circle>
          <circle cx="50" cy="250" r="1.4" fill="#f7c96a" style="animation:boet-spark 1.1s linear infinite"></circle>
        </g>
      </g>
      <g class="sc sc-tent" style="display:none">
        <g style="animation:boet-wobble 1.15s linear infinite;transform-origin:55px 268px">
          <path d="M16 268 L55 198 L94 268 Z" fill="#5f6a4a" stroke="#48523a" stroke-width="2"></path>
          <path d="M42 268 L55 224 L68 268 Z" fill="#47513a"></path>
          <path d="M55 224 L55 268" stroke="#3b4430" stroke-width="2"></path>
          <path d="M94 250 L112 264" stroke="#b8a97c" stroke-width="2"></path>
        </g>
        <rect x="110" y="258" width="5" height="12" rx="2" fill="#8a7a52" transform="rotate(20 112 264)"></rect>
      </g>
      <g class="sc sc-fishing" style="display:none">
        <g>
          <ellipse cx="46" cy="280" rx="44" ry="12" fill="#24404d"></ellipse>
          <ellipse cx="34" cy="278" rx="14" ry="3.5" fill="none" stroke="#3d5d6d" stroke-width="1.5" opacity="0.7"></ellipse>
          <ellipse cx="62" cy="283" rx="10" ry="2.5" fill="none" stroke="#3d5d6d" stroke-width="1.5" opacity="0.5"></ellipse>
        </g>
      </g>
      <g class="sc sc-camp-tool" style="display:none">
        <g>
          <rect x="44" y="232" width="36" height="42" rx="5" fill="#6b4a2e"></rect>
          <ellipse cx="62" cy="232" rx="18" ry="7" fill="#8a6a44"></ellipse>
          <ellipse cx="62" cy="232" rx="10" ry="3.5" fill="none" stroke="#75552f" stroke-width="1.5"></ellipse>
          <rect x="48" y="220" width="28" height="10" rx="4" fill="#7d8188"></rect>
        </g>
      </g>
      <g id="boet-rig">
        <g id="boet-legs"><rect x="101" y="272" width="27" height="14" rx="7" fill="#4e3b28"></rect>
        <rect x="134" y="272" width="27" height="14" rx="7" fill="#443320"></rect>
        <rect x="106" y="236" width="17" height="42" rx="8" fill="#e2ae7e"></rect>
        <rect x="137" y="236" width="17" height="42" rx="8" fill="#d9a271"></rect></g>
        <rect x="101" y="210" width="58" height="32" rx="10" fill="#8a7a52"></rect>
        <path d="M130 224 L130 242" stroke="#6e6140" stroke-width="3"></path>
        <path d="M96 176 q6 -24 34 -24 q28 0 34 24 l3 40 h-74 z" fill="url(#boetShirt)"></path>
        <path d="M102 168 q10 -9 22 -10 l0 58 h-19 q-6 -26 -3 -48 z" fill="url(#boetVest)"></path>
        <path d="M158 168 q-10 -9 -22 -10 l0 58 h19 q6 -26 3 -48 z" fill="url(#boetVest)"></path>
        <rect x="105" y="192" width="14" height="13" rx="2" fill="#48432e"></rect>
        <rect x="141" y="192" width="14" height="13" rx="2" fill="#48432e"></rect>
        <path d="M105 195 h14 M141 195 h14" stroke="#5f5a3f" stroke-width="2"></path>
        <rect x="122" y="138" width="16" height="16" rx="6" fill="#dca070"></rect>
        <circle cx="93" cy="110" r="7" fill="#dca070"></circle>
        <circle cx="167" cy="110" r="7" fill="#dca070"></circle>
        <circle cx="130" cy="108" r="38" fill="url(#boetSkin)"></circle>
        <path d="M96 84 q34 14 68 0 l-2 8 q-32 12 -64 0 z" fill="#b57e4f" opacity="0.25"></path>
        <ellipse cx="106" cy="122" rx="7" ry="4.5" fill="#e88f5e" opacity="0.3"></ellipse>
        <ellipse cx="154" cy="122" rx="7" ry="4.5" fill="#e88f5e" opacity="0.3"></ellipse>
        <g class="boet-eyes" style="animation:boet-blink 4.6s linear infinite;transform-origin:130px 102px">
          <ellipse cx="116" cy="102" rx="8.5" ry="10.5" fill="#fff"></ellipse>
          <ellipse cx="144" cy="102" rx="8.5" ry="10.5" fill="#fff"></ellipse>
          <g id="boet-pupils" style="transition:transform .18s ease-out">
            <circle cx="116" cy="104" r="4.2" fill="#33261c"></circle>
            <circle cx="144" cy="104" r="4.2" fill="#33261c"></circle>
            <circle cx="117.5" cy="102.5" r="1.3" fill="#fff"></circle>
            <circle cx="145.5" cy="102.5" r="1.3" fill="#fff"></circle>
          </g>
        </g>
        <path d="M106 89 q9 -6 19 -3" stroke="#6b4a2e" stroke-width="3.5" stroke-linecap="round" fill="none"></path>
        <path d="M135 86 q10 -3 19 3" stroke="#6b4a2e" stroke-width="3.5" stroke-linecap="round" fill="none"></path>
        <ellipse cx="130" cy="117" rx="5" ry="6.5" fill="#e0a374"></ellipse>
        <path d="M118 128 q12 11 24 0" stroke="#7c4a2c" stroke-width="3" stroke-linecap="round" fill="none"></path>
        <path d="M101 80 q3 -34 29 -34 q26 0 29 34 z" fill="url(#boetHat)"></path>
        <path d="M103 71 q27 11 54 0 l0 9 q-27 9 -54 0 z" fill="#52492f"></path>
        <ellipse cx="130" cy="80" rx="55" ry="12" fill="url(#boetHat)" stroke="#665836" stroke-width="1.5"></ellipse>
        <g class="sc sc-idle" style="">
          <g style="animation:boet-sway 2.6s ease-in-out infinite alternate;transform-origin:97px 166px">
            <rect x="88" y="160" width="18" height="24" rx="9" fill="#b39c6f"></rect>
            <rect x="90" y="176" width="14" height="34" rx="7" fill="#e2ae7e"></rect>
            <circle cx="97" cy="212" r="7" fill="#e8b586"></circle>
          </g>
          <g style="animation:boet-sway 2.6s ease-in-out infinite alternate -1.3s;transform-origin:163px 166px">
            <rect x="154" y="160" width="18" height="24" rx="9" fill="#b39c6f"></rect>
            <rect x="156" y="176" width="14" height="34" rx="7" fill="#d9a271"></rect>
            <circle cx="163" cy="212" r="7" fill="#e0ab7c"></circle>
          </g>
        </g>
        <g class="sc sc-wave" style="display:none">
          <g style="animation:boet-sway 2.6s ease-in-out infinite alternate;transform-origin:97px 166px">
            <rect x="88" y="160" width="18" height="24" rx="9" fill="#b39c6f"></rect>
            <rect x="90" y="176" width="14" height="34" rx="7" fill="#e2ae7e"></rect>
            <circle cx="97" cy="212" r="7" fill="#e8b586"></circle>
          </g>
          <g style="animation:boet-wave .9s ease-in-out infinite alternate;transform-origin:163px 166px">
            <rect x="154" y="160" width="18" height="24" rx="9" fill="#b39c6f"></rect>
            <rect x="156" y="176" width="14" height="34" rx="7" fill="#d9a271"></rect>
            <circle cx="163" cy="212" r="7" fill="#e0ab7c"></circle>
          </g>
        </g>
        <g class="sc sc-lookout" style="display:none">
          <g>
            <rect x="88" y="160" width="18" height="20" rx="9" fill="#b39c6f"></rect>
            <rect x="154" y="160" width="18" height="20" rx="9" fill="#b39c6f"></rect>
            <path d="M100 172 Q84 156 98 136 Q106 124 114 118" stroke="#e2ae7e" stroke-width="13" fill="none" stroke-linecap="round"></path>
            <path d="M160 172 Q176 156 162 136 Q154 124 146 118" stroke="#d9a271" stroke-width="13" fill="none" stroke-linecap="round"></path>
            <circle cx="116" cy="116" r="7" fill="#e8b586"></circle>
            <circle cx="144" cy="116" r="7" fill="#e0ab7c"></circle>
            <rect x="102" y="90" width="24" height="24" rx="7" fill="#3c4034" stroke="#2a2d24" stroke-width="1.5"></rect>
            <rect x="134" y="90" width="24" height="24" rx="7" fill="#3c4034" stroke="#2a2d24" stroke-width="1.5"></rect>
            <rect x="122" y="96" width="16" height="7" rx="3" fill="#33372c"></rect>
            <circle cx="114" cy="102" r="7" fill="#202737"></circle>
            <circle cx="146" cy="102" r="7" fill="#202737"></circle>
            <path d="M110 98 q2 -3 6 -2" stroke="#8fa3b8" stroke-width="1.5" fill="none" opacity="0.7"></path>
            <path d="M142 98 q2 -3 6 -2" stroke="#8fa3b8" stroke-width="1.5" fill="none" opacity="0.7"></path>
          </g>
        </g>
        <g class="sc sc-campfire" style="display:none">
          <g style="animation:boet-sway 2.6s ease-in-out infinite alternate;transform-origin:163px 166px">
            <rect x="154" y="160" width="18" height="24" rx="9" fill="#b39c6f"></rect>
            <rect x="156" y="176" width="14" height="34" rx="7" fill="#d9a271"></rect>
            <circle cx="163" cy="212" r="7" fill="#e0ab7c"></circle>
          </g>
          <g style="animation:boet-poke 1.5s ease-in-out infinite alternate;transform-origin:97px 166px">
            <rect x="88" y="160" width="18" height="20" rx="9" fill="#b39c6f"></rect>
            <rect x="90" y="174" width="14" height="32" rx="7" fill="#e2ae7e"></rect>
            <circle cx="97" cy="208" r="7" fill="#e8b586"></circle>
            <path d="M97 208 L107 261" stroke="#7a5836" stroke-width="5" stroke-linecap="round"></path>
          </g>
        </g>
        <g class="sc sc-tent" style="display:none">
          <g style="animation:boet-sway 2.6s ease-in-out infinite alternate;transform-origin:163px 166px">
            <rect x="154" y="160" width="18" height="24" rx="9" fill="#b39c6f"></rect>
            <rect x="156" y="176" width="14" height="34" rx="7" fill="#d9a271"></rect>
            <circle cx="163" cy="212" r="7" fill="#e0ab7c"></circle>
          </g>
          <g style="animation:boet-hammer 1.15s ease-in infinite;transform-origin:97px 166px">
            <rect x="88" y="160" width="18" height="20" rx="9" fill="#b39c6f"></rect>
            <rect x="90" y="174" width="14" height="32" rx="7" fill="#e2ae7e"></rect>
            <circle cx="97" cy="208" r="7" fill="#e8b586"></circle>
            <path d="M97 208 L103 242" stroke="#7a5836" stroke-width="5" stroke-linecap="round"></path>
            <rect x="93" y="238" width="21" height="12" rx="3" fill="#6b6242"></rect>
          </g>
        </g>
        <g class="sc sc-fishing" style="display:none">
          <g>
            <g style="animation:boet-sway 2.6s ease-in-out infinite alternate -1.3s;transform-origin:163px 166px">
              <rect x="154" y="160" width="18" height="24" rx="9" fill="#b39c6f"></rect>
              <rect x="156" y="176" width="14" height="34" rx="7" fill="#d9a271"></rect>
              <circle cx="163" cy="212" r="7" fill="#e0ab7c"></circle>
            </g>
            <rect x="88" y="160" width="18" height="20" rx="9" fill="#b39c6f"></rect>
            <path d="M97 176 L66 196" stroke="#e2ae7e" stroke-width="13" stroke-linecap="round"></path>
            <circle cx="64" cy="196" r="7" fill="#e8b586"></circle>
            <path d="M64 196 L20 150" stroke="#7a5836" stroke-width="4" stroke-linecap="round"></path>
            <path d="M20 150 L30 268" stroke="#ddd" stroke-width="1.2" opacity="0.7"></path>
            <g style="animation:boet-bobber 3.6s ease-in-out infinite">
              <circle cx="30" cy="271" r="4.5" fill="#c0392b"></circle>
              <path d="M25.5 271 a4.5 4.5 0 0 0 9 0 z" fill="#f4efe2"></path>
            </g>
          </g>
        </g>
        <g class="sc sc-camp-tool" style="display:none">
          <g style="animation:boet-sway 2.6s ease-in-out infinite alternate;transform-origin:163px 166px">
            <rect x="154" y="160" width="18" height="24" rx="9" fill="#b39c6f"></rect>
            <rect x="156" y="176" width="14" height="34" rx="7" fill="#d9a271"></rect>
            <circle cx="163" cy="212" r="7" fill="#e0ab7c"></circle>
          </g>
          <circle cx="60" cy="220" r="1.6" fill="#f7d154" style="animation:boet-flash .5s linear infinite"></circle>
          <circle cx="68" cy="217" r="1.4" fill="#f7d154" style="animation:boet-flash .5s linear infinite .2s"></circle>
          <g style="animation:boet-sharpen .5s ease-in-out infinite alternate;transform-origin:97px 166px">
            <rect x="88" y="160" width="18" height="20" rx="9" fill="#b39c6f"></rect>
            <rect x="90" y="174" width="14" height="32" rx="7" fill="#e2ae7e"></rect>
            <circle cx="97" cy="208" r="7" fill="#e8b586"></circle>
            <path d="M97 206 L64 218 L66 225 L97 216 Z" fill="#c8ccd2" stroke="#9aa0a8" stroke-width="0.8"></path>
            <rect x="93" y="204" width="11" height="12" rx="3" fill="#4a3a28"></rect>
          </g>
        </g>
        <g class="sc sc-map" style="display:none">
          <g>
            <rect x="88" y="160" width="18" height="18" rx="9" fill="#b39c6f"></rect>
            <rect x="154" y="160" width="18" height="18" rx="9" fill="#b39c6f"></rect>
            <path d="M97 172 L108 186" stroke="#e2ae7e" stroke-width="13" stroke-linecap="round"></path>
            <path d="M163 172 L152 186" stroke="#d9a271" stroke-width="13" stroke-linecap="round"></path>
            <g style="animation:boet-maptilt 2.2s ease-in-out infinite alternate;transform-origin:130px 190px">
              <rect x="96" y="164" width="68" height="50" rx="3" fill="#ede3c8" stroke="#c9bc98" stroke-width="1.5"></rect>
              <path d="M119 164 V214 M141 164 V214" stroke="#d8cba6" stroke-width="1.5"></path>
              <path d="M104 206 Q120 188 138 198" stroke="#8a7a52" stroke-width="2" stroke-dasharray="4 3" fill="none"></path>
              <path d="M141 193 l7 7 M148 193 l-7 7" stroke="#c0392b" stroke-width="2.5" stroke-linecap="round"></path>
            </g>
            <circle cx="108" cy="188" r="7" fill="#e8b586"></circle>
            <circle cx="152" cy="188" r="7" fill="#e0ab7c"></circle>
            <text x="168" y="62" style="font:700 30px Barlow,sans-serif;animation:boet-qmark 3.8s linear infinite" fill="#e8a33d">?</text>
          </g>
        </g>
        <g class="sc sc-drive" style="display:none">
          <g>
            <circle cx="243" cy="272" r="5" fill="#a99b78" style="animation:boet-dust .8s linear infinite"></circle>
            <circle cx="240" cy="264" r="4" fill="#a99b78" style="animation:boet-dust 1s linear infinite .3s"></circle>
            <circle cx="246" cy="278" r="3.5" fill="#a99b78" style="animation:boet-dust .7s linear infinite .5s"></circle>
            <rect x="160" y="196" width="78" height="70" rx="6" fill="#66604a" stroke="#45402f" stroke-width="2"></rect>
            <path d="M174 204 V258 M192 204 V258 M210 204 V258 M228 204 V258" stroke="#57523e" stroke-width="3"></path>
            <rect x="18" y="214" width="72" height="52" rx="8" fill="#66604a" stroke="#45402f" stroke-width="2"></rect>
            <path d="M24 224 h10 M24 232 h10 M24 240 h10" stroke="#45402f" stroke-width="2.5"></path>
            <circle cx="28" cy="252" r="5" fill="#f2d98c" stroke="#45402f" stroke-width="1.5"></circle>
            <path d="M88 212 L97 168 L104 168 L96 212 Z" fill="#aebfca" opacity="0.35"></path>
            <path d="M87 213 L97 167" stroke="#4a4534" stroke-width="5" stroke-linecap="round"></path>
            <rect x="88" y="200" width="76" height="66" rx="4" fill="#6d6750" stroke="#45402f" stroke-width="2"></rect>
            <path d="M92 206 h68" stroke="#57523e" stroke-width="2"></path>
            <rect x="146" y="212" width="12" height="4" rx="2" fill="#45402f"></rect>
            <rect x="86" y="260" width="80" height="8" rx="3" fill="#45402f"></rect>
            <path d="M32 266 a23 23 0 0 1 46 0 z" fill="#4e4936"></path>
            <path d="M177 266 a23 23 0 0 1 46 0 z" fill="#4e4936"></path>
            <g>
              <circle cx="55" cy="266" r="19" fill="#26241f"></circle>
              <circle cx="55" cy="266" r="10" fill="#8b8574"></circle>
              <g style="animation:boet-wheel .5s linear infinite;transform-origin:55px 266px">
                <path d="M55 257 V275 M46 266 H64" stroke="#45402f" stroke-width="2.5"></path>
              </g>
              <circle cx="55" cy="266" r="3.5" fill="#45402f"></circle>
            </g>
            <g>
              <circle cx="200" cy="266" r="19" fill="#26241f"></circle>
              <circle cx="200" cy="266" r="10" fill="#8b8574"></circle>
              <g style="animation:boet-wheel .5s linear infinite;transform-origin:200px 266px">
                <path d="M200 257 V275 M191 266 H209" stroke="#45402f" stroke-width="2.5"></path>
              </g>
              <circle cx="200" cy="266" r="3.5" fill="#45402f"></circle>
            </g>
            <path d="M108 190 L114 202" stroke="#33302a" stroke-width="4" stroke-linecap="round"></path>
            <ellipse cx="106" cy="184" rx="4.5" ry="13" fill="none" stroke="#33302a" stroke-width="4"></ellipse>
            <rect x="88" y="160" width="18" height="16" rx="8" fill="#b39c6f"></rect>
            <rect x="154" y="160" width="18" height="16" rx="8" fill="#b39c6f"></rect>
            <path d="M99 170 L106 178" stroke="#e2ae7e" stroke-width="12" stroke-linecap="round"></path>
            <circle cx="107" cy="177" r="6.5" fill="#e8b586"></circle>
            <path d="M161 172 L112 188" stroke="#d9a271" stroke-width="12" stroke-linecap="round"></path>
            <circle cx="110" cy="188" r="6.5" fill="#e0ab7c"></circle>
          </g>
        </g>
      </g>`;

export function AskGgMascot({
  size = 24,
  fill = false,
  alive = false,
  scene,
  mood,
}: {
  size?: number;
  /** Fill the parent box instead of a fixed `size` (launcher scales him). */
  fill?: boolean;
  /** Run the eye-tracking (the launcher's live FAB); off for tiny avatars. */
  alive?: boolean;
  /** The activity to show. Falls back to a calm scene derived from `mood`. */
  scene?: BoetScene;
  mood?: SparkieMood;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  // mood → scene, matching old Sparkie's chat states:
  //   think  → `map`  (his amber "?" pops overhead — "working it out")
  //   happy  → `wave` (a quick friendly wave when the answer lands)
  //   idle   → `idle`
  // An explicit `scene` (the launcher's wander loop) always wins.
  const activeScene: BoetScene =
    scene ?? (mood === 'think' ? 'map' : mood === 'happy' ? 'wave' : 'idle');

  // Show the active scene + swap the rig animation. Mirrors the design's
  // apply(): hide every `.sc`, show this scene's groups (both the outside-
  // rig environment and the in-rig arms share the `.sc-<name>` class),
  // restart their CSS animations (detach → reflow → reattach) so a scene
  // entered mid-cycle starts clean, set the rig style, and drop the legs
  // while driving.
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.querySelectorAll<SVGElement>('.sc').forEach((g) => {
      g.style.display = 'none';
    });
    svg.querySelectorAll<SVGElement>('.sc-' + activeScene).forEach((g) => {
      g.style.display = '';
      g.querySelectorAll<SVGElement>('[style*="animation"]').forEach((el) => {
        const s = el.getAttribute('style') || '';
        el.setAttribute('style', '');
        void el.getBoundingClientRect();
        el.setAttribute('style', s);
      });
    });
    svg.querySelector('#boet-rig')?.setAttribute(
      'style',
      RIGS[activeScene] || DEFAULT_RIG,
    );
    const legs = svg.querySelector<SVGElement>('#boet-legs');
    if (legs) legs.style.display = activeScene === 'drive' ? 'none' : '';
  }, [activeScene]);

  // Eyes follow the cursor — pointer-fine devices, motion allowed, only on
  // the live FAB. rAF-gated; drives the pupil group's transform directly
  // (zero React re-renders). Math is the design's, in the 260×300 box.
  useEffect(() => {
    if (!alive) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    let raf = 0;
    let lx = 0;
    let ly = 0;
    const move = (e: MouseEvent) => {
      lx = e.clientX;
      ly = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const svg = ref.current;
        if (!svg) return;
        const pupils = svg.querySelector<SVGGElement>('#boet-pupils');
        if (!pupils) return;
        const r = svg.getBoundingClientRect();
        const ex = r.left + r.width * (130 / 260);
        const ey = r.top + r.height * (102 / 300);
        const dx = lx - ex;
        const dy = ly - ey;
        const d = Math.hypot(dx, dy) || 1;
        const m = Math.min(d / 40, 1) * 3.4;
        pupils.style.transition = 'transform .18s ease-out';
        pupils.style.transform = `translate(${((dx / d) * m).toFixed(2)}px,${(
          (dy / d) *
          m
        ).toFixed(2)}px)`;
      });
    };
    window.addEventListener('mousemove', move, { passive: true });
    return () => {
      window.removeEventListener('mousemove', move);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [alive]);

  return (
    <svg
      ref={ref}
      className="boet-svg"
      width={fill ? '100%' : size}
      height={fill ? '100%' : size}
      viewBox="0 0 260 300"
      role="img"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible', cursor: 'pointer' }}
      dangerouslySetInnerHTML={{ __html: SVG_INNER }}
    />
  );
}
