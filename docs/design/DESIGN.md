---
name: Luminous Ledger
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#464555'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#684000'
  on-tertiary: '#ffffff'
  tertiary-container: '#885500'
  on-tertiary-container: '#ffd4a4'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: '1.3'
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1.4'
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.4'
  data-mono:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '500'
    lineHeight: '1.0'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  gutter: 24px
  margin-mobile: 16px
  container-max: 1280px
---

## Brand & Style

The design system is engineered for a financial environment where precision meets clarity. The brand personality is authoritative yet approachable, evoking a sense of calm control over complex P2P data. The target audience includes sophisticated investors who require high-density information without the cognitive load of cluttered interfaces.

The chosen style is **Corporate / Modern** with a strong leaning toward **Minimalism**. By prioritizing generous whitespace and a restricted color palette, the system ensures that financial metrics remain the focal point. Elements are defined by subtle depth rather than heavy decoration, creating a "glass-like" purity that feels both premium and technically robust.

## Colors

The palette is anchored by a deep **Indigo (#4F46E5)**, signifying institutional trust and modern technology. 

- **Primary (Indigo):** Used for primary actions, active navigation states, and brand-critical touchpoints.
- **Secondary (Emerald):** Specifically reserved for positive financial trends, growth indicators, and "success" states.
- **Tertiary (Amber):** Utilized for warnings, pending transactions, or neutral-to-cautionary data points.
- **Neutrals (Slate):** A scale of grays ranging from the deep Slate-900 for text to Slate-50 (#F8FAFC) for background surfaces.

Surface colors are strictly divided: the global background uses the cool gray #F8FAFC to reduce eye strain, while interactive containers and cards use pure #FFFFFF to pop forward in the visual hierarchy.

## Typography

This design system utilizes **Plus Jakarta Sans** for its contemporary, open apertures and high legibility at small sizes—critical for ledger-style data. 

To emphasize the "Precision Ledger" aesthetic, numeric data points should optionally utilize **Geist** (specifically in tabular-lining figures) to ensure that columns of numbers align perfectly for easy scanning. 

Hierarchy is established through weight rather than just size. Headlines use bold weights with tighter letter spacing to feel "locked-in," while body text maintains a generous line height of 1.6x for comfortable reading of financial terms and disclosures.

## Layout & Spacing

The layout philosophy follows a **Fixed Grid** model for desktop to maintain the "Golden Ledger" structural integrity, ensuring that data-heavy tables and dashboards do not become uncomfortably wide on ultra-wide monitors.

- **Desktop:** A 12-column grid with a maximum container width of 1280px. Gutters are fixed at 24px.
- **Tablet:** 8-column fluid grid with 24px side margins.
- **Mobile:** 4-column fluid grid with 16px side margins.

The spacing rhythm is strictly based on a 4px baseline. Components should use 16px (md) for internal padding and 24px (lg) for vertical section separation. This creates a rhythmic, airy feel that prevents the financial data from feeling claustrophobic.

## Elevation & Depth

Visual hierarchy is achieved through a combination of **Ambient Shadows** and **Low-Contrast Outlines**. 

The system avoids heavy dropshadows in favor of "Soft Depth." Most containers use a 1px border colored at #E2E8F0 (Slate-200). For elevated elements like active cards or dropdown menus, a secondary shadow is applied:
- **Shadow-Sm:** 0px 1px 2px rgba(0, 0, 0, 0.05).
- **Shadow-Md:** 0px 4px 12px rgba(15, 23, 42, 0.03), 0px 1px 2px rgba(15, 23, 42, 0.06).

This "stacked" approach ensures that even in a light-mode environment, the user can instantly distinguish between the background, the content container, and the interactive overlay.

## Shapes

The shape language is defined as **Rounded**, striking a balance between the rigidity of traditional finance and the softness of modern consumer tech. 

Base components (Buttons, Inputs, Small Cards) use a 0.5rem (8px) corner radius. Larger layout containers (Dashboard Sections, Main Content Areas) use a 1rem (16px) radius. This softening of the "Ledger" corners makes the interface feel more approachable and less like a legacy spreadsheet.

## Components

- **Buttons:** Primary buttons use a solid #4F46E5 fill with white text. Secondary buttons use a ghost style: a 1px border of #E2E8F0 with #4F46E5 text, transitioning to a soft gray background on hover.
- **Input Fields:** Use a #FFFFFF background with a 1px border of #CBD5E1. On focus, the border transitions to #4F46E5 with a 3px soft indigo outer glow.
- **Cards:** The "Ledger Card" is the core unit. It must have a pure white background, a 1px Slate-200 border, and 24px of internal padding.
- **Data Chips:** Small, pill-shaped indicators for "Portfolio Category" or "Asset Type." Use a low-saturation background (e.g., 10% opacity of the primary color) with high-contrast text.
- **Progress Bars:** Thin (4px) height for asset allocation visualizations, using the Primary and Secondary colors to denote distribution.
- **Lists:** Table rows ("Precision Ledger" style) should have a subtle #F8FAFC hover state and no vertical borders, using only horizontal dividers to maintain a clean, scanned look.