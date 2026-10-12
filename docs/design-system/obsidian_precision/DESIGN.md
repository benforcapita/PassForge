---
name: Obsidian Precision
colors:
  surface: '#111317'
  surface-dim: '#111317'
  surface-bright: '#37393d'
  surface-container-lowest: '#0c0e11'
  surface-container-low: '#1a1c1f'
  surface-container: '#1e2023'
  surface-container-high: '#282a2d'
  surface-container-highest: '#333538'
  on-surface: '#e2e2e6'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#e2e2e6'
  inverse-on-surface: '#2f3034'
  outline: '#849495'
  outline-variant: '#3b494b'
  surface-tint: '#00dbe9'
  primary: '#dbfcff'
  on-primary: '#00363a'
  primary-container: '#00f0ff'
  on-primary-container: '#006970'
  inverse-primary: '#006970'
  secondary: '#47f4c1'
  on-secondary: '#003829'
  secondary-container: '#07d7a6'
  on-secondary-container: '#005842'
  tertiary: '#fff3f3'
  on-tertiary: '#67001e'
  tertiary-container: '#ffcdd0'
  on-tertiary-container: '#be003f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#7df4ff'
  primary-fixed-dim: '#00dbe9'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#53fdc9'
  secondary-fixed-dim: '#24e0ae'
  on-secondary-fixed: '#002117'
  on-secondary-fixed-variant: '#00513d'
  tertiary-fixed: '#ffdadc'
  tertiary-fixed-dim: '#ffb2b9'
  on-tertiary-fixed: '#40000f'
  on-tertiary-fixed-variant: '#91002e'
  background: '#111317'
  on-background: '#e2e2e6'
  surface-variant: '#333538'
typography:
  headline-xl:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  code-display:
    fontFamily: JetBrains Mono
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: 0.04em
  code-body:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.06em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-compact: 0.5rem
  margin: 1.25rem
  margin-window: 0.75rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

The design system establishes a high-precision, technical dark aesthetic engineered specifically for a stateless, local-first cryptographic utility on macOS. The interface targets security-conscious developers, cryptographic practitioners, and power users who value zero-knowledge architecture, deterministic generation, and tactical efficiency over generic consumer friendliness.

The visual style merges technical minimalism with high-precision developer-tool design:
- **Zero-Storage Cryptographic Cues:** Interfaces reflect purity and impermanence; values exist in transient memory rather than lingering states.
- **Surface Architecture:** Deep obsidian and charcoal foundation layers emulate native macOS translucent tooling while maintaining sharp, non-distracting visual boundaries.
- **Signal-to-Noise Focus:** Interactive controls are low-profile until engaged. Electric cyan and cold teal accents strictly communicate cryptographic synthesis, entropy health, and primary actions.
- **Native Density:** Compact layouts, keyboard-first navigation patterns, and information-dense telemetry panels typical of high-end desktop workstation utilities.

## Colors

The color palette is strictly dark-mode-only, structured around deep light-absorbent base tones and high-contrast phosphorescent accents.

- **Primary (`#00f0ff` - Electric Cyan):** Designates active cryptographic generation, deterministic outputs, primary execution triggers, and focused interactive states.
- **Secondary (`#0bd8a7` - Cold Teal / Matrix Green):** Signals validated zero-knowledge hashes, entropy strength indicators, and successful clipboard operations.
- **Tertiary (`#ff3864` - Tactical Crimson):** Reserved strictly for entropy warnings, profile destruction triggers, counter mismatches, and salt corruption warnings.
- **Neutral (`#090b0e` - Obsidian Void):** The architectural substrate. Extended across discrete tonal layers:
  - `surface-canvas`: `#090b0e` (Base window frame and desktop underlay).
  - `surface-subtle`: `#11141a` (Sidebar, persistent telemetry bars).
  - `surface-elevated`: `#171b22` (Active generation panels, dialogs, cards).
  - `border-tactical`: `rgba(255, 255, 255, 0.08)` (Micro-dividers and structural bounding boxes).
  - `text-primary`: `#f3f4f6` (High-contrast content and generated secrets).
  - `text-muted`: `#6b7280` (Technical labels, derivation metadata, parameter tags).

## Typography

The typographic hierarchy implements an intentional duality between natural UI navigation (`Geist`) and cryptographic, algorithmic readouts (`JetBrains Mono`).

- **Interface Hierarchy (`Geist`):** Used for view titles, profile labels, descriptive context, and interactive commands. Tighter tracking at display scales produces a solid, precision-engineered feel.
- **Cryptographic & Telemetry Layer (`JetBrains Mono`):** Used across password generation outputs, master password masking grids, hash iterations, cryptographic fingerprints, salt tags, and counter controls. Monospaced rendering ensures visual alignment of variable-length digests and character-type distribution.
- **Display Treatment:** Generated tokens render with enhanced tracking (`code-display`) to distinguish visually similar characters (`0` vs `O`, `l` vs `1`) directly through monospace glyph differentiation.

## Layout & Spacing

The layout is optimized for a native desktop application with fixed and adaptable panes:

- **Structural Layout:** A dual-column layout utilizing a persistent utility sidebar (240px fixed width) paired with a responsive generation canvas (min 420px, max 640px centered).
- **Rhythm & Grid:** Built on an absolute 4px/8px modular scale. Dense packaging ensures all primary derivation parameters (Site, Master Key, Login, Counter, Character Rules) fit within standard window viewports without vertical scrolling.
- **Window Framing:** A consolidated header region (`margin-window`) accommodates macOS traffic-light window controls while preserving seamless alignment with the underlying canvas.

## Elevation & Depth

Visual depth is achieved through physical surface stratification and hairline boundaries rather than dramatic drop shadows:

- **Tonal Layering:** 
  - `Layer 0 (Canvas Base)`: Pure dark obsidian (`#090b0e`).
  - `Layer 1 (Panels & Shell)`: Charcoal tint (`#11141a`) with a 1px tactical border (`rgba(255, 255, 255, 0.07)`).
  - `Layer 2 (Inputs & Containers)`: Elevated dark slate (`#171b22`) for interactive areas.
- **Hairline Dividers:** No heavy structural borders; all elements utilize 1px semi-transparent borders with crisp, unblurred boundaries.
- **Luminescent Accent Glows:** Active inputs and calculated password displays feature subtle cyan-tinted ambient borders (`box-shadow: 0 0 0 1px #00f0ff, 0 0 12px rgba(0, 240, 255, 0.15)`), giving the impression of an activated electronic instrument.
- **Modals & Overlays:** Backdrop blur (`backdrop-filter: blur(12px)`) using translucent base tones (`rgba(9, 11, 14, 0.75)`) preserving spatial context beneath cryptographic confirmation dialogs.

## Shapes

The interface implements a restrained, low-radius shape profile (`roundedness: 1`) to emphasize mechanical precision, clean alignment, and tool-like utility:

- **Standard Elements (`4px / 0.25rem`):** Inputs, standard buttons, rule chips, counter steppers, and list items.
- **Cards & Primary Modules (`8px / 0.5rem`):** Password result displays, derivation parameter cards, and modal dialogs.
- **Tactical Indicators (`2px`):** Entropy bars, clipboard feedback indicators, and active status indicators.

## Components

### Buttons
- **Primary Action (Generate / Synthesize):** High-contrast electric cyan background (`#00f0ff`) with deep obsidian text (`#090b0e`), monospace label font, `4px` corner radius, and subtle glow on hover.
- **Secondary / Utility (Copy, Clear, Step):** Muted charcoal surface (`#171b22`), `1px` tactical outline (`rgba(255, 255, 255, 0.12)`), white secondary text (`#e5e7eb`), shifting to cyan outline on hover.
- **Destructive (Purge Session):** Low-profile flat surface with tactical crimson text (`#ff3864`), transitioning to subtle red glow on hover.

### Inputs & Parameter Controls
- **Master Password Input:** Concealed by default with an instant cryptographic hash-preview icon. Rendered with monospace font (`code-body`), background `#171b22`, hairline border, and zero native browser focus rings (replaced by the cyan hairline border).
- **Domain & Counter Stepper:** Combined input and stepper group. Stepper increment/decrement buttons integrated directly into the input rail with monospace numerals.

### Cryptographic Result Display
- Prominently housed in a dedicated card with an `#11141a` base and a faint top-edge highlight.
- Output text utilizes `code-display` (`JetBrains Mono`, 20px). Alternates numeric, lowercase, uppercase, and special characters with subtle color-coding (e.g., symbols highlighted in teal, digits in cyan) to facilitate manual transcription.
- Features quick-action keyboard shortcut triggers (e.g., `⌘C` copy, `⌘⇧C` copy & wipe memory in 15 seconds).

### Character Rule Chips (Flags)
- Compact toggles for character sets (`A-Z`, `a-z`, `0-9`, `!@#`).
- Inactive: Bordered `#11141a` with muted text (`#6b7280`).
- Active: Bordered `#00f0ff` with electric cyan text and faint teal inner fill (`rgba(0, 240, 255, 0.08)`).

### Entropy / Derivation Progress Indicator
- Horizontal multi-segment bar displaying PBKDF2/argon iteration calculations or generation entropy.
- Colored segments render in cold teal (`#0bd8a7`) under optimal configurations and switch to tactical crimson (`#ff3864`) if master key entropy is insufficient.

### Ephemeral Notification Banner (Toast)
- Minimal floating pill centered at bottom or docked in header: pure black surface, hairline cyan border, monospace uppercase notification (`"COPIED TO CLIPBOARD — WIPING IN 12S"`), accompanied by a descending progress line.