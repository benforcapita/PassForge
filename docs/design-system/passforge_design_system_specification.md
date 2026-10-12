# PassForge Design System Specification
**Version:** 1.0.0  
**Target Platform:** macOS Desktop (Tauri v2 + React 19 + Tailwind CSS v3/v4)  
**Theme:** Dark Only (Obsidian / Tactical Precision)  
**Target Window Base:** 1180 × 760 px (Minimum: 980 × 720 px)

---

## 1. Design Principles

1. **Secrets Are Monochromatic Raw Data**  
   Sensitive strings (passwords, hashes, salt seeds, tokens) must never be decorated, italicized, or tinted with semantic colors (no green-for-strong or red-for-weak text coloring on secrets). Secrets are rendered strictly in pure monospace in high-contrast neutral (`#F1F5F9`) on a darkened utility container. Color is reserved for system states and metadata, never the secrets themselves.

2. **Zero Ambient Color (Tactical Restraint)**  
   The UI is 95% monochromatic neutral obsidian and zinc. Accent color (`#06B6D4` Cyan) is applied strictly to active interactive affordances, primary triggers, and keyboard focus rings. Destructive actions (`#EF4444` Crimson) and alerts (`#F59E0B` Amber) are sparse and high-signal. If everything glows, nothing is secure.

3. **Density and Spatial Predictability Over Airiness**  
   PassForge is a power-user instrument, not marketing SaaS. Controls are tight (32px default input/button heights), information density is compact, and layouts are rigid 3-pane desktop splitters. Keyboard shortcuts and tab sequences dictate the layout hierarchy.

4. **Explicit Cryptographic State Feedback**  
   Stateless generation relies on mathematical certainty. The UI visually distinguishes between calculated parameters and ephemeral output. Feedback mechanisms (visual hash fingerprints, countdown timers, clipboard auto-wipe indicators) must be precise, instantaneous, and deterministic.

5. **Irreversible Actions Require Friction**  
   Deleting local profile parameters or wiping the local encrypted master vault triggers unmistakable high-contrast destructive surfaces with explicit keyboard confirmation (`Cmd + Backspace` or typing `DELETE`).

---

## 2. Color Tokens

### Palette Rationale
PassForge's palette reflects a modern cryptographic terminal. We use an obsidian-grade base (`#090D16` to `#1E293B`) to avoid washed-out grays and achieve pitch-black contrast without pure OLED clipping. The primary accent is a cold, razor-sharp **Cyan 500 (`#06B6D4`)**—chosen because it feels like precision instrumentation and high-speed memory bus signaling, steering far away from playful consumer purples or generic enterprise enterprise blues.

### Token Table

| Token Name | Hex Code | Intended Use |
| :--- | :--- | :--- |
| **Surfaces** | | |
| `surface-canvas` | `#070A0F` | Window frame, native titlebar background, backdrop |
| `surface-base` | `#0D1117` | Sidebar pane, secondary container background |
| `surface-raised` | `#161B22` | Vault list column, active pane panels, modal dialogs |
| `surface-overlay` | `#21262D` | Menus, popovers, tooltips, dropdown sheets |
| `surface-input` | `#0B0F17` | Input field fill, secret display wells |
| `surface-input-focus` | `#111622` | Active input background during typing |
| **Accents & Brand** | | |
| `accent-primary` | `#06B6D4` | Primary actions, key badges, active toggle track |
| `accent-primary-hover` | `#0891B2` | Hovered state of primary buttons |
| `accent-primary-muted` | `rgba(6, 182, 212, 0.12)` | Active navigation row fill, selected list item |
| `accent-secondary` | `#38BDF8` | Auxiliary links, highlighted parameters, counter badges |
| **Status & Feedback** | | |
| `status-error` | `#EF4444` | Destructive buttons, validation errors, lock breach alert |
| `status-error-bg` | `rgba(239, 68, 68, 0.12)` | Danger banner fill, destructive button background |
| `status-warning` | `#F59E0B` | Clipboard countdown warning (< 5s), unsaved parameter |
| `status-warning-bg` | `rgba(245, 158, 11, 0.12)` | Warning callout background |
| `status-success` | `#10B981` | "Copied" toast checkmark, generation sync confirm |
| `status-success-bg` | `rgba(16, 185, 129, 0.12)` | Success badge background |
| **Borders & Dividers** | | |
| `border-subtle` | `#21262D` | Pane splitters, list row bottom borders, input resting borders |
| `border-moderate` | `#30363D` | Active card borders, container outlines, button outlines |
| `border-strong` | `#484F58` | Hovered card borders, active input borders |
| `border-focus` | `#06B6D4` | Focused input border, keyboard selection focus ring |
| **Text Hierarchy** | | |
| `text-primary` | `#F0F6FC` | Headings, active values, high-contrast labels, secrets |
| `text-secondary` | `#8B949E` | Secondary metadata, parameter titles, inactive tab labels |
| `text-muted` | `#484F58` | Placeholder text, hotkey hints, timestamp captions |
| `text-on-accent` | `#070A0F` | Text inside primary Cyan buttons and badges |
| `text-error` | `#F87171` | Inline validation error labels |

---

## 3. Typography

### Families
- **UI Font:** `Inter`, `-apple-system`, `BlinkMacSystemFont`, `"SF Pro Text"`, sans-serif
- **Monospace Font:** `"JetBrains Mono"`, `"SF Mono"`, `Menlo`, monospace  
  *(Enforce `font-feature-settings: "zero" 1, "cv02" 1` for slashed zeros and unmistakable character distinction).*

### Type Scale

| Style Name | Font Family | Size (px / rem) | Weight | Line Height | Letter Spacing | Scope / Application |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `display` | UI | 22px / 1.375rem | 600 (Semibold) | 28px | -0.02em | Master Lock header, dialog titles |
| `title` | UI | 16px / 1.0rem | 600 (Semibold) | 22px | -0.015em | Pane titles, vault item names |
| `body-medium` | UI | 13px / 0.8125rem | 500 (Medium) | 18px | -0.005em | Form labels, navigation tabs, buttons |
| `body` | UI | 13px / 0.8125rem | 400 (Regular) | 18px | 0 | Description text, options copy |
| `caption` | UI | 11px / 0.6875rem | 500 (Medium) | 14px | +0.02em | Metadata tags, hotkey badges, timestamps |
| `code-display` | Monospace | 16px / 1.0rem | 500 (Medium) | 24px | +0.05em | **Generated password preview**, master seed |
| `code-body` | Monospace | 12px / 0.75rem | 400 (Regular) | 16px | 0 | Hash fingerprints, salt strings, site seeds |

---

## 4. Spacing, Radius, and Elevation

### Spacing Scale (4px Base Grid)
- `space-1`: 4px
- `space-1.5`: 6px
- `space-2`: 8px
- `space-3`: 12px
- `space-4`: 16px
- `space-5`: 20px
- `space-6`: 24px
- `space-8`: 32px
- `space-10`: 40px

### Border Radius Scale
*Design stance:* **Sharp, machined geometry.** We reject bubbly, consumer iOS-style curves (16px+) in favor of disciplined, tight radii (4px to 6px) that reinforce technical desktop precision.

- `radius-none`: `0px` (Pane splitters, flush dividers)
- `radius-sm`: `4px` (Buttons, input boxes, tag pills, hotkey badges, list rows)
- `radius-md`: `6px` (Detail cards, popovers, dropdown menus, toast banners)
- `radius-lg`: `8px` (Main modal dialog windows)

### Elevation Model
*Design stance:* **Flat, layered containment.** We avoid fuzzy directional drop-shadows. Elevation is expressed via contrasting surface luminance (`#0D1117` vs `#161B22`) and crisp 1px borders (`#21262D` and `#30363D`). Modals use a subtle hairline glow.

- `elevation-none`: border only, no shadow.
- `elevation-dropdown`: `box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px #30363D;`
- `elevation-modal`: `box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px #30363D;`
- `elevation-focus`: `box-shadow: 0 0 0 2px #06B6D4;`

---

## 5. Layout Anatomy

Standard window target: **1180 × 760 px** (Draggable macOS titlebar region with 3 native traffic lights padding).

```
+----------------------------------------------------------------------------------------------------+
|  [● ● ●] PassForge        [Search: ⌘K]                   [Lock Icon: ⌘L] [Vault Status: Local/Enc] | (40px Topbar)
+---------------+-------------------------+----------------------------------------------------------+
|  SIDEBAR      |  ENTRY LIST COLUMN      |  DETAIL / INSPECTOR PANE                                 |
|  (220px)      |  (320px)                |  (Flex 1, min 440px)                                     |
|               |                         |                                                          |
|  - All (24)   |  [Sort/Filter Bar: 36px]|  Header: Site Title + Fingerprint Glyphs                 |
|  - Logins     |  - Github.com           |  ------------------------------------------------------- |
|  - Servers    |  - AWS Console          |  Site / Login / Counter / Crypto Algorithm Parameters    |
|  - Keys       |  - Proton Mail          |  ------------------------------------------------------- |
|  - Trash      |  - Cloudflare           |  [••••••••••••••••••••••••] [Eye] [Copy Password (⌘C)]   |
|               |                         |  Clipboard Auto-Clear: [======= 18s Remaining =======]   |
+---------------+-------------------------+----------------------------------------------------------+
|  STATUS BAR (24px): Local SQLite (Encrypted) • Algorithm: LessPass v2 SHA-256 • Latency: 0.8ms       |
+----------------------------------------------------------------------------------------------------+
```

### Exact Shell Measurements
- **Window Topbar / Chrome:** Height `40px` (Traffic lights offset `pl-18`, integrated search, quick-lock button `w-7 h-7`).
- **Sidebar Width:** Fixed `220px` (Padding `p-3`).
- **Entry List Column:** Fixed `320px` (Search/filter row `36px`, list items height `54px`).
- **Detail Pane:** Fluid flex `1` (Min width `440px`, padding `p-6`).
- **Status Bar:** Height `24px` (Border-top `1px solid #21262D`, text `11px monospace`, padding `px-3`).
- **Grid Gaps & Splitters:** Resizable splitters `1px` border with `4px` hit target.

---

## 6. Component Specifications

### 1. Buttons
- **Primary (`btn-primary`):**
  - Height: `32px` | Padding: `px-3.5` | Radius: `4px` | Font: `13px Medium`
  - Default: Background `#06B6D4`, Text `#070A0F`, Border `none`
  - Hover: Background `#0891B2`
  - Active: Background `#0E7490`
  - Focus: Ring `2px #06B6D4` offset `2px #070A0F`
  - Disabled: Background `#21262D`, Text `#484F58`
- **Ghost (`btn-ghost`):**
  - Height: `32px` | Padding: `px-3` | Radius: `4px` | Font: `13px Medium`
  - Default: Background `transparent`, Text `#8B949E`, Border `1px solid #21262D`
  - Hover: Background `#161B22`, Text `#F0F6FC`, Border `#30363D`
  - Active: Background `#21262D`
- **Danger (`btn-danger`):**
  - Height: `32px` | Padding: `px-3.5` | Radius: `4px` | Font: `13px Medium`
  - Default: Background `rgba(239, 68, 68, 0.15)`, Text `#F87171`, Border `1px solid rgba(239, 68, 68, 0.3)`
  - Hover: Background `#EF4444`, Text `#FFFFFF`
  - Active: Background `#DC2626`
- **Icon Button (`btn-icon`):**
  - Dimensions: `28px × 28px` | Radius: `4px`
  - Default: Text `#8B949E`, Background `transparent`
  - Hover: Text `#F0F6FC`, Background `#161B22`

### 2. Inputs (Text & Password / Secret Display)
- **Standard Input:**
  - Height: `32px` | Padding: `px-2.5` | Radius: `4px` | Font: `13px Regular`
  - Default: Background `#0B0F17`, Border `1px solid #21262D`, Text `#F0F6FC`, Placeholder `#484F58`
  - Hover: Border `1px solid #30363D`
  - Focus: Border `1px solid #06B6D4`, Background `#111622`, Outline `none`
- **Password / Secret Well (`secret-well`):**
  - Height: `44px` | Padding: `px-3` | Radius: `4px` | Font: `15px Monospace (JetBrains Mono)`
  - Default: Background `#070A0F`, Border `1px solid #30363D`, Text `#F0F6FC`
  - Features: Right-aligned inline quick-copy (`Cmd+C`) and visibility toggle glyphs. Zero colored text formatting.

### 3. Entry List Row
- Height: `54px` | Radius: `4px` | Padding: `px-3 py-2` | Border-bottom: `1px solid #161B22`
- Default: Background `transparent`
- Hover: Background `#161B22`
- Active / Selected: Background `rgba(6, 182, 212, 0.12)`, Border-left: `2px solid #06B6D4`
- Anatomy: Left site icon/initials badge (`28px`), Middle site name (`13px Semibold`) + login handle (`11px Secondary`), Right fingerprint glyph preview.

### 4. Cryptographic Fingerprint Chips
- **Fingerprint Bar:** 3 colored geometric SVG glyphs (circle, diamond, hexagram) uniquely derived from SHA-256 of `(master_password + site + login + counter)`.
- Dimensions: `14px × 14px` each with `4px` gap.
- Purpose: Instant subconscious visual verification that the master password was entered correctly without revealing any characters.

### 5. Tag Pills & Parameter Badges
- Height: `20px` | Padding: `px-2` | Radius: `3px` | Font: `11px Monospace Medium`
- Default: Background `#161B22`, Border `1px solid #21262D`, Text `#8B949E`
- Counter Badge: `Counter: #2` rendered in Background `rgba(6, 182, 212, 0.1)`, Text `#06B6D4`.

### 6. Modal Dialog
- Width: `460px` | Min-height: `280px` | Radius: `8px` | Background: `#161B22` | Border: `1px solid #30363D`
- Backdrop: `rgba(7, 10, 15, 0.75)` with `backdrop-filter: blur(4px)`.
- Header: `px-5 py-4` with border-bottom `1px solid #21262D`.
- Footer: `px-5 py-3.5` with border-top `1px solid #21262D`, right-aligned CTA buttons with `8px` gap.

### 7. Toast & Clipboard Countdown Variant
- Width: `340px` | Height: `44px` | Radius: `6px` | Background: `#161B22` | Border: `1px solid #30363D`
- Position: Bottom-right (`bottom-6 right-6`).
- **Countdown Variant:**
  - Includes an embedded bottom hairline progress bar (`2px` height) shrinking from 100% to 0% over 20,000ms.
  - Text: `"Password copied to clipboard • Clearing in 18s"` (`12px UI Regular`).
  - Bar Color: `#06B6D4` transitioning to `#F59E0B` when remaining time < 5s.

### 8. Toggles & Sliders
- **Toggle Switch:**
  - Track: `36px × 20px`, Radius: `10px`, Background `#21262D` (Inactive) / `#06B6D4` (Active).
  - Thumb: `16px × 16px`, Radius: `8px`, Background `#FFFFFF`, Offset `2px`.
- **Character Length Slider:**
  - Track: Height `4px`, Background `#21262D`, Radius `2px`.
  - Filled Track: Background `#06B6D4`.
  - Thumb: `14px × 14px`, Radius `7px`, Background `#F0F6FC`, Border `2px solid #06B6D4`.

---

## 7. Iconography

### Icon System: `Lucide Icons` (SVG, 1.5px Stroke Width)
*Rationale:* Lucide provides clean, geometric, non-rounded vector primitives that align directly with macOS desktop conventions and technical utility software.

| Action / Element | Lucide Icon Name | Standard Size | Color Token |
| :--- | :--- | :--- | :--- |
| Quick Lock App | `lock` | 16px | `text-secondary` (hover: `text-primary`) |
| Vault Unlocked | `unlock` | 16px | `accent-primary` |
| Master Key / Auth | `key-round` | 18px | `accent-primary` |
| Copy Password | `copy` | 14px | `text-secondary` |
| Copied Confirmation | `check` | 14px | `status-success` |
| Reveal Password | `eye` | 14px | `text-secondary` |
| Conceal Password | `eye-off` | 14px | `text-secondary` |
| Regenerate Password | `refresh-cw` | 14px | `accent-secondary` |
| Delete Entry | `trash-2` | 14px | `status-error` |
| Settings | `sliders-horizontal` | 16px | `text-secondary` |
| Search Vault | `search` | 14px | `text-muted` |
| Quick Generate | `zap` | 16px | `accent-primary` |
| Local Database | `hard-drive` | 14px | `text-muted` |
| Warning / Security Alert | `alert-triangle` | 16px | `status-warning` |

---

## 8. States & Feedback

### 1. Locked vs. Unlocked States
- **Locked Screen:** Full-window takeover (`surface-canvas`). Sidebar and list are fully unmounted from the DOM (not just obscured). Centered cryptographic card (`380px` wide) displaying the Master Password input, local biometric fallback indicator, and a security note: `"Local memory clear. Stateless engine dormant."`
- **Unlocked Screen:** 3-pane workbench reveals instantly with focus defaulted to Entry Filter (`Cmd + F`).

### 2. Idle-Lock Transition
- After configurable inactivity (default 5 min), a 10-second warning banner appears in the status bar (`status-warning`). At 0 seconds, memory registers containing the salt/master key are zeroized in RAM and UI transitions immediately to the Locked Screen.

### 3. Copy-to-Clipboard Flow
1. User hits `Cmd + C` or clicks copy icon.
2. Icon immediately swaps to `check` (`#10B981`) for `1200ms`.
3. Toast spawns with countdown timer (`20s` auto-wipe).
4. System sound: subtle macOS native tick.
5. At countdown completion, clipboard is cleared via OS API and toast dismisses.

### 4. Skeleton Loading & Errors
- Given PassForge is local-first, disk operations are < 5ms. Skeletons (`#161B22` with `#21262D` shimmer) are only used during initial encrypted SQLite index verification.
- **Error Surfacing:** Inline errors appear directly beneath parameter inputs in `text-error` (`#F87171`) with a `11px` caption. Never modal dialogs for basic validation errors.

---

## 9. Motion & Transitions

*Accessibility Constraint:* All transitions must respect `@media (prefers-reduced-motion: reduce)`. When enabled, transition duration is set to `0ms`.

### Timings & Easings
- **Fast Micro-interactions (hover, button click, icon swap):** `100ms cubic-bezier(0.16, 1, 0.3, 1)`
- **Drawer / Pane Resizing:** `150ms ease-out`
- **Modal Enter / Exit:** `180ms cubic-bezier(0.16, 1, 0.3, 1)` (Scale `0.98 -> 1.0`, Opacity `0 -> 1`)
- **Clipboard Progress Bar:** Linear countdown (`20,000ms linear`)

### Explicit Motion Boundary
- **Never Animated:** Secret characters, password text reveals, cryptographic hash values, list item reordering on filter. These must snap instantaneously to preserve absolute precision.

---

## 10. Accessibility

- **Contrast Ratios (WCAG AA Compliance):**
  - `text-primary` (`#F0F6FC`) on `surface-canvas` (`#070A0F`): **18.4:1** (Passes AAA)
  - `text-secondary` (`#8B949E`) on `surface-raised` (`#161B22`): **5.2:1** (Passes AA)
  - `accent-primary` (`#06B6D4`) on `surface-base` (`#0D1117`): **8.1:1** (Passes AAA)
- **Focus Rings:** Non-negotiable `2px solid #06B6D4` with `2px` offset (`#070A0F`) on all active `:focus-visible` elements.
- **Keyboard Navigation Sequence:**
  - `Cmd + K`: Global jump to entry / quick search
  - `Cmd + N`: Create new generation parameter profile
  - `Cmd + C`: Copy generated password to clipboard
  - `Cmd + Shift + C`: Copy username / login
  - `Cmd + L`: Immediate vault lock & memory zeroization
  - `Cmd + ,`: Open Preferences / Crypto settings

---

## 11. Voice & Copy Guidelines

### Tone Rules
- **Direct, Concise, Technical.** Do not speak in friendly corporate platitudes ("Oops! Something went wrong"). State what happened mathematically and what the remedy is.
- **No Marketing Fluff.** Use words like *Parameters*, *Stateless Generation*, *Local Vault*, *Zeroized*. Avoid *Magical*, *Cloud-powered*, *Easy*.

### String Catalog
- **Unlock Failure:** `"Authentication failed. Master key does not match local vault signature."`
- **Delete Confirmation:** `"Delete entry parameters for github.com? Generated passwords cannot be recovered without exact parameters."`
- **Clipboard Toast:** `"Password copied to clipboard. Memory buffer will wipe in 20s."`
- **Zero-Cloud Notice:** `"PassForge is stateless. Passwords exist only in memory during generation."`

---

## 12. Token Export (Production-Ready)

### CSS Custom Properties (`tokens.css`)

```css
:root {
  /* Surfaces */
  --pf-surface-canvas: #070A0F;
  --pf-surface-base: #0D1117;
  --pf-surface-raised: #161B22;
  --pf-surface-overlay: #21262D;
  --pf-surface-input: #0B0F17;
  --pf-surface-input-focus: #111622;

  /* Accents */
  --pf-accent-primary: #06B6D4;
  --pf-accent-primary-hover: #0891B2;
  --pf-accent-primary-muted: rgba(6, 182, 212, 0.12);
  --pf-accent-secondary: #38BDF8;

  /* Status */
  --pf-status-error: #EF4444;
  --pf-status-error-bg: rgba(239, 68, 68, 0.12);
  --pf-status-warning: #F59E0B;
  --pf-status-warning-bg: rgba(245, 158, 11, 0.12);
  --pf-status-success: #10B981;
  --pf-status-success-bg: rgba(16, 185, 129, 0.12);

  /* Borders */
  --pf-border-subtle: #21262D;
  --pf-border-moderate: #30363D;
  --pf-border-strong: #484F58;
  --pf-border-focus: #06B6D4;

  /* Typography */
  --pf-text-primary: #F0F6FC;
  --pf-text-secondary: #8B949E;
  --pf-text-muted: #484F58;
  --pf-text-on-accent: #070A0F;
  --pf-text-error: #F87171;

  /* Radii */
  --pf-radius-sm: 4px;
  --pf-radius-md: 6px;
  --pf-radius-lg: 8px;
}
```

### Tailwind Config Block (`tailwind.config.ts`)

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        pf: {
          canvas: '#070A0F',
          base: '#0D1117',
          raised: '#161B22',
          overlay: '#21262D',
          input: {
            DEFAULT: '#0B0F17',
            focus: '#111622',
          },
          accent: {
            primary: '#06B6D4',
            hover: '#0891B2',
            muted: 'rgba(6, 182, 212, 0.12)',
            secondary: '#38BDF8',
          },
          status: {
            error: '#EF4444',
            'error-bg': 'rgba(239, 68, 68, 0.12)',
            warning: '#F59E0B',
            'warning-bg': 'rgba(245, 158, 11, 0.12)',
            success: '#10B981',
            'success-bg': 'rgba(16, 185, 129, 0.12)',
          },
          border: {
            subtle: '#21262D',
            moderate: '#30363D',
            strong: '#484F58',
            focus: '#06B6D4',
          },
          text: {
            primary: '#F0F6FC',
            secondary: '#8B949E',
            muted: '#484F58',
            'on-accent': '#070A0F',
            error: '#F87171',
          },
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '4px',
        md: '6px',
        lg: '8px',
      },
      boxShadow: {
        dropdown: '0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px #30363D',
        modal: '0 16px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px #30363D',
        'focus-ring': '0 0 0 2px #06B6D4',
      },
    },
  },
};

export default config;
```
