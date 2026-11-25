# Shiplines · hull lines lab

**Flinders University · Maritime Archaeology Program**

Shiplines is a browser-based teaching tool for ship hull lines. Students shape a hull by dragging the handles of a control cage. A Catmull–Clark subdivision surface turns the cage into a smooth hull, as Blender's *Subdivision Surface* modifier does at level 2. Waterlines, buttock lines, stations and diagonals are sliced from that surface live. One click turns the hull into a traditional lines drawing (sheer, half-breadth and body plans) on an aged drafting sheet at a true scale.

The 2D drawing follows the conventions of J. R. Steffy (*Wooden Ship Building and the Interpretation of Shipwrecks*, 1994), as taught in F. Castro's lines-drawing course at the Nautical Archaeology Digital Library:

- bow to the left
- plans titled **Sheer**, **Body** and **Half-Breadth**
- sections lettered **A, B, C …** towards the bow and numbered **1, 2, 3 …** towards the stern from the midship section, which carries the amidships mark
- load waterline placed by default at about **3/5 of the midship depth**

A switch shows the naval-architecture alternative for comparison: bow to the right, stations numbered 0 (aft) to N (forward).

## Running it

The app is static HTML and JavaScript with no build step. Three.js and all fonts are vendored, so it works offline. ES modules have to be served over HTTP; opening the file directly won't work.

```bash
cd shiplines
python3 -m http.server 8000
# open http://localhost:8000
```

**GitHub Pages:** go to *Settings → Pages → Deploy from a branch* and choose `main` / root. The site will appear at `https://<user>.github.io/shiplines/`.

## What students can do

| Area | Features |
|---|---|
| **Presets** | Cargo ship (full, boxy); clipper ship after the *Flying Fish* lines (long hollow entrance and run, full deck line, counter stern); canoe; 18th-century warship in the manner of HMS *Victory* (low, broad, bluff bow, tumblehome, broad square stern); and a simple practice hull |
| **Shaping** | Click a handle and drag the gizmo. *Point*, *Section* and *Fore–aft row* selection modes, typed x/y/z coordinates, and undo/redo. Keel, stem and sternpost handles are locked to the centreplane. |
| **Surface** | Catmull–Clark levels 0–4, with hologram, solid and **zebra** (reflection-stripe fairness check) shading. Control cage, wireframe, mirrored port side and LWL plane can each be toggled. |
| **Lines (3D)** | Stations (gold), waterlines (cyan, LWL highlighted), buttock lines (magenta), diagonals (green), and profile and sheer (white). Each has its own colour; all share a common, adjustable thickness. Counts and spacing are adjustable. |
| **Views** | Perspective, plus orthographic profile (sheer), plan (half-breadth) and end (body) views |
| **Hull data** | LOA, beam, depth, LWL draught, volume, displacement (sea water), LCB, and C<sub>b</sub>, C<sub>p</sub>, C<sub>m</sub>, C<sub>wp</sub>, all live |
| **Lines drawing** | ISO A4–A1 sheet with zone-referenced frame, title block, scale of metres and an automatically chosen standard scale. The body plan goes beside the sheer plan, or below it for long hulls. Aged paper or clean, black or coloured inks, with the student's name and date. |
| **Export** | Drawing as SVG (fonts embedded) or 150 dpi PNG, or print; table of offsets as CSV; hull as OBJ (Blender/Rhino); design as JSON (re-openable); 3D snapshot as PNG |

## Play mode

The opening screen offers two choices. **Test your skills** starts the challenge, and **Explore ship lines** goes straight to the tool. The ▶ PLAY button and the gold side-panel card also start the challenge.

An old shipwright introduces each round. The challenge has four rounds and 100 points:

1. **Know your lines (20).** A line flashes on the hull. Say whether it is a station, waterline, buttock or diagonal, and which plan shows its true shape. A reference lines drawing of the same hull is beside the questions; after each answer the line is shown in red in all three plans.
2. **Steffy’s labels (15).** A section flashes in profile. Give its Steffy label: A, B, C forward or 1, 2, 3 aft of midships.
3. **Match the section (30).** In the end (body) view, drag four handles of the midship control section until the hull’s midship section lies on the owner’s dashed target. Live match %, C<sub>m</sub> and C<sub>b</sub> are shown. This hull becomes the student's certificate drawing.
4. **Fair the hull (35).** Four handles are shown: three were knocked out of line and one is sound. Fair the hull using zebra shading and a live fairness meter (control-cage curvature energy), keeping its dimensions and displacement.

Grades follow the Flinders scale: High Distinction 85+, Distinction 75+, Credit 65+, Pass 50+. The defaults are *John McCarthy* and *The Pie Floater*; students change them on the start screen. **View certificate** opens the student's own lines plan with a *Certificate of Proficiency* cartouche and seal.

**Handles:** drag a handle directly. It moves in the plane of the current view, so the profile, plan and end views give clean 2-D moves. Clicking a handle gives the arrow gizmo, and the arrow keys nudge the selection (Shift = fine).

## How the geometry works

- **Cage.** An 11 × 7 grid of control points runs stern→bow and keel→sheer, for the starboard half only.
- **Subdivision.** On a regular quad grid, Catmull–Clark is exactly the tensor product of the 1-D cubic B-spline rules (vertex ⅛·¾·⅛, edge ½·½). The open edges use the standard crease rules and the corners stay fixed, matching Blender's "keep corners" boundary behaviour. So keel and stem points on the centreplane stay on it at every level. See `js/subdiv.js`.
- **Lines.** Each line is the exact intersection of the subdivided mesh with a plane. The segments are chained into polylines through shared mesh edges (`js/slicer.js`). In the drawing, the curves are run through those intersection points with a Catmull–Rom "batten".
- **Hydrostatics.** Sectional areas below the LWL are integrated along the length from 48 transverse slices (`js/lines.js`).

The presets are parametric teaching forms (`js/presets.js`) and are not reconstructions of particular vessels.

## Files

```
index.html          app shell
css/style.css       Flinders-branded UI
js/main.js          state, UI wiring, undo, exports
js/presets.js       parametric hull presets and centreplane constraints
js/subdiv.js        Catmull–Clark subdivision on the cage grid
js/slicer.js        plane slicing and polyline chaining
js/lines.js         stations, waterlines, buttocks, diagonals, hydrostatics, table of offsets
js/viewer3d.js      three.js scene, handles, gizmo, shaders, bloom
js/drawing2d.js     SVG lines drawing (Steffy conventions), sheet, title block
vendor/three/       three.js r187 (MIT) and the addons used
fonts/              Rajdhani, JetBrains Mono, Architects Daughter, IM Fell English SC (OFL 1.1), Special Elite (Apache 2.0)
assets/             optional official logo (see below)
```

## Branding

The UI uses the Flinders master colours, **Flinders Gold #FFD300** and **Midnight Blue #002F60**, with a text wordmark. The official logo is not included, because the University's brand policy reserves logo use for approved versions. To add it, save an approved file as `assets/flinders-logo.svg` and it replaces the wordmark in the header automatically.

## Credits

Made by John McCarthy for the Maritime Archaeology Program, College of Human Sciences and Culture, Flinders University. Created using Claude.
three.js © three.js authors (MIT). Font licences are in `fonts/licenses/`.
