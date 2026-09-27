# ZANZA STUDIO — PRODUCT

---

## 1. THE SHOW

**ZANZA** is an original adult animated comedy set in **Zanza City** in **2097** — a
fictional East African megacity.

The governing irony of the world:

> The technology is futuristic. The people are still people.

Zanza City has advanced AI, autonomous transit, holographic interfaces, smart
apartments and automated bureaucracy. Its inhabitants still have rent, bad bosses,
jealousy, rent strikes, dating, side hustles, landlord nonsense, family pressure,
embarrassment, and poor decisions. The comedy comes from ordinary human problems
occurring in an extraordinary environment.

**Language** blends English, Sheng, and contemporary Kenyan slang naturally, as
characters actually talk. Specificity is the goal; a joke should feel like it was
written by someone who has been here.

**Not** a generic "African sci-fi" pastiche, and **not** a stereotype showcase. The
city must feel like a real place that happens to be fictional, and the people must
feel like people who happen to live in the future.

## 2. LEGAL / ORIGINALITY BOUNDARY

ZANZA is an original universe. Do not reference, reproduce, or imitate the
characters, artwork, dialogue, branding, or storylines of any existing show, film,
game, or brand. Zanza City is fictional. No real public figures, no real business
names. Adult animated sitcoms are a **production-philosophy** reference
(reusable casts, reusable sets, expressive dialogue, comedic timing), never a
content reference.

## 3. CORE CAST (initial)

| Character | Role | Comedy engine |
|---|---|---|
| **NIA** (23, Kilimani 2.0) | Protagonist. Aspiring musician, creator, occasional hustler. Witty, confident, ambitious, impulsive, secretly insecure about failure. | Believes she has it handled. She does not. |
| **KITO** | Friend. Ambitious hustler with relentless, doomed business ideas. Confident especially when obviously wrong. | "I have a plan." The plan is terrible. Occasionally the terrible plan works. |
| **MAMA NIA** | Nia's mother. Loves her, does not fully trust her unconventional career. | Generational expectation and family pressure, without caricature. |
| **THE LANDLORD** | Obsessed with rent, rules, and extracting money from tenants. | Runs like a traditional landlord inside a futuristic city. That contrast *is* the joke. |

Small cast on purpose. Depth over headcount.

## 4. CORE LOCATIONS (initial)

| Location | Role |
|---|---|
| **NIA'S APARTMENT** | Primary. Couch, table, kitchen, doors, windows, wall screens, staging anchors. |
| **ZANZA STREET** | The external city. Evolved matatu transit, signage, traffic. |
| **ZANZA LOUNGE** | Recurring social/nightlife location. |

## 5. WHAT THE SOFTWARE IS FOR

Produce an episode of a recurring animated sitcom **without re-creating the world
every episode**.

```
BUILD NIA ONCE ──> used in every episode, forever
BUILD HER FLAT ONCE ──> used in every scene set in it
BUILD "ARMS CROSSED" ONCE ──> used by every character who crosses arms
```

A production tool succeeds when episode 40 is *faster* to make than episode 1. Every
architecture decision in `ARCHITECTURE.md` is downstream of that sentence.

## 6. THE PRODUCTION PIPELINE

The long-run workflow this tool exists to serve:

```
IDEA -> SCRIPT -> EPISODE BREAKDOWN -> SCENE BREAKDOWN -> ASSET SELECTION
     -> STAGING -> DIALOGUE -> ANIMATION -> CAMERA -> AUDIO
     -> PREVIEW -> EDIT -> RENDER -> PUBLISH
```

MVP scope ends at **STAGING → DIALOGUE → ANIMATION → CAMERA → PREVIEW → EXPORT**
for a single scene. The stages before and after are represented in the data model
so they can be added without a migration.

## 7. FIRST TECHNICAL MILESTONE

> **NIA + KITO + NIA'S APARTMENT + DIALOGUE + EXPRESSIONS + MOVEMENT + CAMERA +
> TIMELINE + AUDIO + PREVIEW + EXPORT → a real ZANZA scene.**

Pilot scene: **EP001 "RENT IS DUE"**, scene 1, `NIA'S APARTMENT`. Nia on the couch.
Kito enters. Four lines of dialogue. That is the acceptance test for the entire
MVP. If that scene can be staged, timed, previewed and exported, the system works.

## 8. THE PRODUCT IS NOT

- ❌ A drawing app
- ❌ A generic canvas with draggable PNGs
- ❌ Photoshop / Canva / After Effects
- ❌ A game engine
- ❌ Mobile-first

It is a **production system**. The document structure enforces that; a canvas that
accepts arbitrary images does not.
