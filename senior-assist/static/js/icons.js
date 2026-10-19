/* Saathi icon set — hand-made SVGs so the app looks the same everywhere (no emoji differences).
   Line icons use currentColor (they follow light / dark mode). Tile icons are small flat illustrations. */
const ICONS = (() => {
  const line = (d, extra = '') => `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  return {
    // ---- line icons (toolbar, settings, buttons)
    home: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path fill="currentColor" d="M12 3.2 2.6 11a1 1 0 0 0 .64 1.77H5V20a1 1 0 0 0 1 1h4.2v-5.4h3.6V21H18a1 1 0 0 0 1-1v-7.23h1.76A1 1 0 0 0 21.4 11Z"/></svg>`,
    back: line('<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>'),
    repeat: line('<path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/>'),
    help: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#f59e0b"/><path d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4.1" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="18" r="1.4" fill="#fff"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path fill="currentColor" d="M20.6 14.9A8.6 8.6 0 0 1 9.1 3.4a.6.6 0 0 0-.8-.7A9.6 9.6 0 1 0 21.3 15.7a.6.6 0 0 0-.7-.8Z"/></svg>`,
    sound: line('<path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
    globe: line('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z"/>'),
    bell: line('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.6 2H4.4Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    mic: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    chevron: line('<path d="m9 6 6 6-6 6"/>'),
    speaker: line('<path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>'),
    logout: line('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>'),
    check: line('<path d="M4 12.5 9.5 18 20 6.5"/>'),
    history: line('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/>'),
    xmark: line('<path d="M6 6l12 12M18 6 6 18"/>'),
    pause: line('<path d="M9 6v12M15 6v12"/>'),
    clock: line('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    list: line('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'),
    heart: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.5-4.6-9.5-9.3C1 8.2 3.3 4.5 7 4.5c2 0 3.4 1.1 5 2.9 1.6-1.8 3-2.9 5-2.9 3.7 0 6 3.7 4.5 7.2C19.5 16.4 12 21 12 21Z"/></svg>`,
    wave: '👋',

    // ---- tile illustrations (task cards, options)
    bill: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 5h24v38l-4-3-4 3-4-3-4 3-4-3-4 3Z" fill="#ffffff" stroke="#8f86f5" stroke-width="2.4" stroke-linejoin="round"/><path d="M17 14h14M17 20h14M17 26h9M17 32h12" stroke="#a49cf7" stroke-width="2.4" stroke-linecap="round"/><path d="M12 5h24v5H12z" fill="#c9c3fb"/></svg>`,
    ticket: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 15a3 3 0 0 0 3-3h32a3 3 0 0 0 3 3v4a4 4 0 0 0 0 8v4a3 3 0 0 0-3 3H8a3 3 0 0 0-3-3v-4a4 4 0 0 0 0-8Z" fill="#fbbf24" stroke="#d97706" stroke-width="2"/><path d="M31 13v22" stroke="#b45309" stroke-width="2" stroke-dasharray="3 3"/><path d="M11 20h14M11 25h10M11 30h12" stroke="#92400e" stroke-width="2.2" stroke-linecap="round"/></svg>`,
    video: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="13" width="27" height="22" rx="5" fill="#34d399" stroke="#059669" stroke-width="2"/><path d="m32 21 10-6v18l-10-6Z" fill="#10b981" stroke="#059669" stroke-width="2" stroke-linejoin="round"/><circle cx="13" cy="20" r="2.5" fill="#ecfdf5"/></svg>`,
    shield: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 40 10v12c0 10-7 18-16 22C15 40 8 32 8 22V10Z" fill="#93c5fd" stroke="#3b82f6" stroke-width="2.2" stroke-linejoin="round"/><path d="m17 24 5 5 9-10" fill="none" stroke="#1d4ed8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    bus: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="6" width="32" height="32" rx="7" fill="#a5b4fc" stroke="#6366f1" stroke-width="2"/><rect x="12" y="12" width="24" height="11" rx="2" fill="#eef2ff"/><circle cx="16" cy="31" r="2.6" fill="#4338ca"/><circle cx="32" cy="31" r="2.6" fill="#4338ca"/><path d="M14 38v4M34 38v4" stroke="#4338ca" stroke-width="3" stroke-linecap="round"/><path d="M8 26h32" stroke="#6366f1" stroke-width="2"/></svg>`,
    train: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="4" width="28" height="32" rx="9" fill="#c4b5fd" stroke="#7c3aed" stroke-width="2"/><rect x="14" y="10" width="20" height="10" rx="2" fill="#f5f3ff"/><circle cx="17" cy="28" r="2.4" fill="#5b21b6"/><circle cx="31" cy="28" r="2.4" fill="#5b21b6"/><path d="m15 36-5 8M33 36l5 8M13 42h22" stroke="#5b21b6" stroke-width="2.6" stroke-linecap="round"/></svg>`,
    bulb: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5a13 13 0 0 0-7.6 23.6c1.5 1.1 2.6 3 2.6 4.9V35h10v-1.5c0-1.9 1.1-3.8 2.6-4.9A13 13 0 0 0 24 5Z" fill="#fde047" stroke="#ca8a04" stroke-width="2"/><path d="M19 39h10M20 43h8" stroke="#a16207" stroke-width="2.6" stroke-linecap="round"/><path d="M21 22l3 4 3-4" fill="none" stroke="#a16207" stroke-width="2" stroke-linecap="round"/></svg>`,
    water: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5s13 14.5 13 24a13 13 0 0 1-26 0C11 19.5 24 5 24 5Z" fill="#7dd3fc" stroke="#0284c7" stroke-width="2.2" stroke-linejoin="round"/><path d="M17 30a7 7 0 0 0 7 7" fill="none" stroke="#e0f2fe" stroke-width="2.6" stroke-linecap="round"/></svg>`,
    mobile: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="13" y="4" width="22" height="40" rx="5" fill="#a7f3d0" stroke="#059669" stroke-width="2.2"/><rect x="16.5" y="9" width="15" height="26" rx="1.5" fill="#ecfdf5"/><circle cx="24" cy="39.5" r="1.8" fill="#059669"/></svg>`,
    calendar: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="9" width="36" height="33" rx="6" fill="#ffffff" stroke="#8f86f5" stroke-width="2.2"/><path d="M6 15a6 6 0 0 1 6-6h24a6 6 0 0 1 6 6v4H6Z" fill="#a49cf7"/><path d="M15 5v8M33 5v8" stroke="#6d5df5" stroke-width="3" stroke-linecap="round"/><rect x="13" y="25" width="6" height="5" rx="1" fill="#c9c3fb"/><rect x="21" y="25" width="6" height="5" rx="1" fill="#6d5df5"/><rect x="29" y="25" width="6" height="5" rx="1" fill="#c9c3fb"/></svg>`,
    seat_lower: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="27" width="34" height="9" rx="3" fill="#86efac" stroke="#16a34a" stroke-width="2"/><rect x="7" y="9" width="34" height="9" rx="3" fill="#e5e7eb" stroke="#9ca3af" stroke-width="2"/><path d="M10 36v6M38 36v6" stroke="#16a34a" stroke-width="3" stroke-linecap="round"/><path d="m24 19 0 5m-3-2 3 3 3-3" stroke="#16a34a" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
    seat_any: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 8h20a3 3 0 0 1 3 3v16H11V11a3 3 0 0 1 3-3Z" fill="#c4b5fd" stroke="#7c3aed" stroke-width="2"/><rect x="8" y="26" width="32" height="8" rx="3" fill="#a78bfa" stroke="#7c3aed" stroke-width="2"/><path d="M13 34v8M35 34v8" stroke="#7c3aed" stroke-width="3" stroke-linecap="round"/></svg>`,
    doc: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 4h17l9 9v29a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="#ffffff" stroke="#8f86f5" stroke-width="2.2" stroke-linejoin="round"/><path d="M29 4v9h9" fill="#c9c3fb" stroke="#8f86f5" stroke-width="2.2" stroke-linejoin="round"/><path d="M16 20h14M16 26h10" stroke="#a49cf7" stroke-width="2.4" stroke-linecap="round"/><circle cx="30" cy="33" r="6" fill="#ede9fe" stroke="#6d5df5" stroke-width="2.6"/><path d="m34.5 37.5 5 5" stroke="#6d5df5" stroke-width="3" stroke-linecap="round"/></svg>`,
    camera: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 15h7l3-5h12l3 5h7a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V18a3 3 0 0 1 3-3Z" fill="#c4b5fd" stroke="#7c3aed" stroke-width="2.2" stroke-linejoin="round"/><circle cx="24" cy="27" r="8" fill="#f5f3ff" stroke="#7c3aed" stroke-width="2.4"/><circle cx="24" cy="27" r="3.5" fill="#7c3aed"/></svg>`,
    volunteer: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="17" cy="15" r="6" fill="#fdba74" stroke="#ea580c" stroke-width="2"/><circle cx="32" cy="15" r="6" fill="#fcd34d" stroke="#d97706" stroke-width="2"/><path d="M5 38c1-8 6-13 12-13s9 3 10 7" fill="#fb923c" stroke="#ea580c" stroke-width="2"/><path d="M21 38c1-8 5-13 11-13s11 5 12 13Z" fill="#fbbf24" stroke="#d97706" stroke-width="2"/><path d="M24 30c2-2 4-2 6 0" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
    letter: (ch, bg) => `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="${bg}"/><text x="24" y="31" text-anchor="middle" font-size="21" font-weight="700" fill="#fff" font-family="Saathi Sans, sans-serif">${ch}</text></svg>`,
  };
})();

/* Friendly grandparent avatars shown next to Saathi's questions. */
const AVATARS = {
  grandpa: `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="58" fill="var(--avatar-bg, #e9e5ff)"/>
    <path d="M24 112c4-20 18-30 36-30s32 10 36 30a58 58 0 0 1-72 0Z" fill="#7c6cf2"/>
    <path d="M50 80h20l-10 13Z" fill="#ffffff"/>
    <rect x="52" y="66" width="16" height="16" rx="6" fill="#f2c4a0"/>
    <ellipse cx="60" cy="50" rx="23" ry="26" fill="#f6d0b1"/>
    <path d="M35 47c-3-17 9-27 25-27s28 10 25 27c-3-7-6-10-10-11-6 4-24 4-30 0-4 1-7 4-10 11Z" fill="#e5e7eb"/>
    <ellipse cx="36" cy="52" rx="4" ry="6" fill="#f2c4a0"/><ellipse cx="84" cy="52" rx="4" ry="6" fill="#f2c4a0"/>
    <circle cx="50" cy="51" r="7" fill="none" stroke="#4b5563" stroke-width="2.6"/><circle cx="70" cy="51" r="7" fill="none" stroke="#4b5563" stroke-width="2.6"/>
    <path d="M57 51h6" stroke="#4b5563" stroke-width="2.4"/>
    <circle cx="50" cy="51" r="2" fill="#374151"/><circle cx="70" cy="51" r="2" fill="#374151"/>
    <path d="M51 64c5 5 13 5 18 0" fill="none" stroke="#b45309" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M47 60c4-2 8-2 13 0 5-2 9-2 13 0" fill="none" stroke="#d1d5db" stroke-width="3" stroke-linecap="round"/>
    <path d="M16 38l6 3M14 50h7M104 38l-6 3M106 50h-7" stroke="#a49cf7" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,
  grandma: `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="58" fill="var(--avatar-bg, #ffe8f1)"/>
    <path d="M24 112c4-20 18-30 36-30s32 10 36 30a58 58 0 0 1-72 0Z" fill="#c0479a"/>
    <path d="M36 94c10-6 38-6 48 0" stroke="#f9a8d4" stroke-width="4" fill="none"/>
    <rect x="52" y="66" width="16" height="16" rx="6" fill="#e9b48f"/>
    <circle cx="60" cy="20" r="10" fill="#d1d5db"/>
    <ellipse cx="60" cy="50" rx="23" ry="26" fill="#efc3a1"/>
    <path d="M36 50c-4-19 8-30 24-30s28 11 24 30c-4-9-10-14-24-15-14 1-20 6-24 15Z" fill="#e5e7eb"/>
    <circle cx="60" cy="40" r="2.6" fill="#dc2626"/>
    <circle cx="50" cy="52" r="7" fill="none" stroke="#6b7280" stroke-width="2.6"/><circle cx="70" cy="52" r="7" fill="none" stroke="#6b7280" stroke-width="2.6"/>
    <path d="M57 52h6" stroke="#6b7280" stroke-width="2.4"/>
    <circle cx="50" cy="52" r="2" fill="#374151"/><circle cx="70" cy="52" r="2" fill="#374151"/>
    <path d="M51 64c5 5 13 5 18 0" fill="none" stroke="#be185d" stroke-width="2.6" stroke-linecap="round"/>
    <circle cx="37" cy="58" r="2.4" fill="#fbbf24"/><circle cx="83" cy="58" r="2.4" fill="#fbbf24"/>
    <path d="M16 38l6 3M14 50h7M104 38l-6 3M106 50h-7" stroke="#f9a8d4" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,
};
