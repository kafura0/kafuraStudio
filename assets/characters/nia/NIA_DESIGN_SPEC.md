# NIA Character Design Specification

**File:** `assets/characters/nia/NIA_DESIGN_SPEC.md`  
**Source:** Zanza Studio Character Reference Sheet ("Nia")  
**Target:** 2D Vector Animation Rig  

---

## 1. Face and Facial Features

* **Face Shape:** Heart-shaped taper leading to a soft, defined, slightly rounded chin; smooth jawline and subtly defined cheekbones.
* **Skin Tone:** Warm medium golden-brown/caramel.
* **Eyes:** Large, expressive almond-shaped eyes with a pronounced upward/cat-eye sweep at the outer corners. Deep black/charcoal upper lash lines. Warm hazel/amber-brown irises with distinct round pupils and clean white primary specular highlights.
* **Eyebrows:** Dark brown/black arched brows; groomed, medium thickness tapering cleanly toward the temples.
* **Nose:** Small, delicate button nose. The bridge is minimally outlined; base defined by a soft underside shadow, upturned tip, and subtle nostril outlines.
* **Smile & Lips:** Wide, radiant open smile showing a clean, continuous band of white upper teeth. Full lips with a defined cupid's bow, rendered in a warm natural peach/rose tone.

---

## 2. Hair

* **Silhouette & Asymmetry:** Highly asymmetrical, shoulder-length locs. Voluminous coverage sweeping across the character's right side, draping across the forehead and cheek. The character's left side is pulled back/flatter, leaving the left ear and jawline exposed.
* **Parting & Crown:** Deep side part positioned above the character's left temple. Visible dark scalp sections and root growth along the parting line. The crown consists of clustered loc bases radiating outward.
* **Roots & Color Gradient:** High-contrast two-tone coloration. Bases/roots are dark espresso brown to near-black, transitioning through a short blend into warm sandy/honey-blonde shafts and blunt tips.
* **Loc Structure:** Cylindrical, textured dreadlocks of medium thickness; structured as individual rounded cords with visible spiral twisting/segments.

---

## 3. Body Proportions

*(All values are visual estimates based on the turnaround sheet; not physically measured)*

* **Head-to-Body Ratio:** Approximately 1 : 7.2 to 1 : 7.5 heads tall (stylized athletic fashion proportions).
* **Shoulders:** Moderately broad, natural athletic alignment; visually widened by the dropped-shoulder cut of the jacket.
* **Torso:** Short, compact upper torso with an exposed midriff extending from below the bustline down to the high-waist belt line. Slender waist with subtle abdominal contouring.
* **Arms & Hands:** Slender, toned arms. Elbows sit approximately at the natural waist; wrists align near the pelvic crest. Hands are slender with defined, elongated fingers.
* **Hips & Legs:** Straight to subtly curved hips. Legs appear elongated, making up approximately 55% of total body height, further accentuated by the high-waisted, wide-leg trouser cut and ankle fabric stacking.

---

## 4. Clothing and Accessories

* **Jacket:** Cropped, deep-purple hooded windbreaker/track jacket. Loose silhouette with gathered elastic waist hem and 3/4-length pushed-up gathered sleeves. Features a high-contrast neon-magenta/pink zipper track and interior lining visible when unzipped. A small neon-magenta three-point crown emblem is centered on the back between the shoulder blades.
* **Top:** Fitted black/dark-slate scoop-neck crop top ending squarely below the bust.
* **Trousers:** High-waisted, ultra-baggy dark-slate/charcoal cargo pants. 
  * Secured by a dark webbing belt with a square silver/gunmetal frame buckle.
  * Standard front slash pockets and deep rear patch pockets.
  * Large bellows cargo pockets on both outer mid-thighs featuring flap closures, vertical center straps, and buckle/rivet hardware.
  * Smaller bellows pockets on the outer lower shins.
  * Legs pool and fold heavily over the shoes.
* **Footwear:** Chunky platform retro-style runners. Heavy sculpted white soles with visible tread blocks, dark-slate/black uppers, purple overlay panels along the heel/counter, white-and-black laces, and a small purple/neon tongue patch.
* **Visible Accessories:**
  * **Necklace:** Thin silver-toned chain holding an open, geometric double-rhombus (diamond within a diamond) pendant centered over the sternum.
  * **Earrings:** Silver-toned hoop earrings (clearly seen on the exposed left ear).
  * **Wrists:** Double-wrap thin dark cord/leather bracelets on both wrists.
  * **Belt Loop:** Dark key-strap/tag hanging from the front belt loop on the character's right hip.

---

## 5. Color Palette

*(Estimated HEX codes sampled from the reference swatches and flat color fills)*

| Area / Swatch Label | Base Tone (Est. HEX) | Shadow / Secondary (Est. HEX) |
| :--- | :--- | :--- |
| **Skin Tone** | `#CE8B61` | `#B06E46` |
| **Hair (Blonde Locs)** | `#DFBA81` | `#C29A5F` |
| **Hair (Dark Roots)** | `#2B1E1A` | `#1D1412` |
| **Jacket Purple** | `#44235E` | `#2F1843` |
| **Neon Accent (Zipper / Crown)** | `#E2128E` | `#B50E72` |
| **Top Black** | `#24212C` | `#1A1820` |
| **Pants Black** | `#24212C` | `#1A1820` |
| **Shoe White** | `#EDEBF0` | `#C5C0CD` |
| **Shoe Black** | `#201E27` | `#141318` |
| **Shoe Purple** | `#A84BCF` | `#7E32A0` |
| **Jewelry (Silver)** | `#D0D4DA` | `#9DA3AE` |
| **Eyes (Hazel/Amber)** | `#B58242` | `#7D5524` |

---

## 6. View Consistency

### Must Remain Consistent Across Turnaround Views
* **Asymmetrical Hair Draping:** The heavy loc volume, forehead bangs, and forward drape must consistently fall on the character's **right side**; the exposed ear and parted hairline must remain on the character's **left side**.
* **Crown Logo Placement:** Present strictly on the back panel of the cropped jacket; it does not wrap around to front or side profiles.
* **Exposed Midriff Gap:** The negative-space distance between the crop top hem and high-waisted trouser waistband must remain proportional across front, 3/4, and side profiles.
* **Belt Accessory:** The dangling key strap must remain anchored strictly to the front-right belt loop.
* **Pendant Center Line:** The geometric pendant must consistently anchor at the suprasternal notch.

### Cannot Be Confirmed from Reference
* **Under-Jacket Construction:** Sleeve cut and back design of the black crop top cannot be verified because the jacket is worn across all full-body views.
* **Jacket Closure:** Appearance of the jacket when fully zipped cannot be verified (shown open only).
* **Right Ear Anatomy:** The right ear is entirely covered by blonde locs in all views; whether a matching hoop earring is worn on that side cannot be confirmed.

---

## 7. Vector-Rig Simplification

* **Modular Loc Assemblies:** Consolidate the hair into 10–12 discrete vector "sausage" tubes with smooth stroke outlines. Replace dense braided line textures with a simple 2-stop linear gradient (dark root to honey blonde) plus a single cel-shaded shadow edge.
* **Trouser Creases & Folds:** Reduce the high-frequency realistic creasing to 4–6 graphic polygonal shadow patches around the knees, crotch line, and ankle breaks.
* **Cargo Pocket Hardware:** Eliminate micro-stitching and tiny metallic eyelets. Retain only the solid bounding boxes for pockets, outer flaps, and simplified rectangular buckle clips.
* **Sneaker Geometry:** Simplify complex tread ridges and mesh cutouts into three flat, stylized color blocks: solid white sole, black upper, and purple heel cap.
* **Elastic Gathering:** Model jacket cuffs and hem gathers as simple undulating 3-point scalloped vector curves rather than complex fabric folds.

---

## Top Five Identity-Defining Features
*(Ranked by visual recognition at animation stage scale)*

1. **Two-Tone Honey-Blonde & Dark-Rooted Asymmetrical Locs:** The signature high-volume, right-swept silhouette.
2. **Deep Violet Cropped Windbreaker Jacket:** Primary mid-tone silhouette definer with distinct pushed-up 3/4 sleeves.
3. **High-Contrast Neon-Magenta Zipper/Lining Accent:** Sharp, vibrant vertical line cutting through the dark upper body.
4. **High-Waisted Baggy Dark Cargo Pants:** Distinct oversized lower-body silhouette featuring ankle stacking and pronounced thigh pockets.
5. **Chunky Black/White/Purple Platform Runners:** Solid, oversized footwear grounding the proportions.

---

## Preservation vs. Simplification

### Must Preserve
* Specific asymmetrical loc drape (sweeping right, clearing left ear).
* Two-tone blonde/espresso hair gradient.
* Cropped jacket / exposed midriff / high-waist pant proportion rhythm.
* Neon-magenta zipper accent line and rear crown emblem.
* Double-rhombus silver pendant.
* Almond/cat-eye tilt and warm hazel eye color.

### Safe to Simplify
* Internal cord texture and individual strand lines on locs.
* Micro-wrinkles and fabric distress on trousers and jacket.
* Realistic sole tread patterns and lace eyelets on sneakers.
* Seam stitching lines on cargo flaps and belt loops.
* Soft painterly blushes on cheeks and nose tip (convert to clean vector cel shapes or soft radial alpha masks).

---

## Uncertainties Requiring Human Review

1. **Right Ear Piercing:** Confirm whether the obscured right ear has a silver hoop earring matching the visible left ear.
2. **Top Construction:** Define the back/strap layout of the black crop top for scenes where the jacket might be removed or altered.
3. **Jacket Closure Mechanics:** Define zipper behavior and front silhouette if the windbreaker is ever fully zipped up in animation.