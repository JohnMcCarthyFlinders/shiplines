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

## Trace a plan

Load a scanned lines plan (PNG/JPG) behind the **Profile**, **Plan** or **End** view, and the hull's lines are drawn over it.
- **Calibrate:** click two points on the drawing (the stern and bow ends of the baseline; the centreline in plan; or, in the end view, the centreline and a point a known distance out on the baseline), then enter the distance between them. The image is scaled, rotated and placed to match.
- **Drawing faces the other way:** it is mirrored so it stays upright. Switch the convention to see it as drawn; the calibration stays fixed in space.
- **Move image:** drag moves the image, scroll scales it about the pointer, and Shift+scroll rotates it (hold Alt for fine steps). Esc or Done finishes; **Reset adjustments** returns to the calibrated position.
- **Simplified tracing view:** while a plan is behind its view, only the outline and the lines that are true curves in that view are shown, in Flinders gold: buttocks in profile, waterlines in plan, stations in the end view. The hull surface, wireframe, straight lines and labels are hidden, and handles become pink diamonds. A checkbox turns this off.
- **Fine-tuning:** typed shift, scale and rotate values, opacity, and light-on-dark display.
- **Saving:** underlays are saved with the design.

## Trace lines → hull (lofting)

For recovering a hull from a lines plan, Shiplines works the way a draughtsman does: trace the lines, then build the surface through them.

1. **Load and calibrate the plan** behind each view (*Trace a plan*). Calibration anchors are fixed: the first click is x = 0 on the baseline, so use the same aft and forward references (perpendiculars or end stations) in Profile and Plan.
2. **Start tracing** and draw battens: keel, stem, sternpost and sheer in the Profile view; the deck line in Plan (optional); and the sections in the End view. **+ Add section** asks for a click on the profile at the station, then switches to the End view. Either side of the body plan can be traced.
   - Click to add points, drag to move, click on a batten to insert, and Shift+click to delete.
   - Right-drag pans and scroll zooms.
   - Undo covers tracing too.
3. **Loft:** once the keel, stem, sternpost, sheer and two or more sections exist, a hull is lofted through the sections (stem and sternpost act as the end sections). It uses a common girth parameter from keel to sheer and is held to the traced keel, sheer and deck lines.
4. **Check:** the lofted hull's own buttocks (Profile), waterlines (Plan) and stations (End) are drawn in gold over the scan. Where they part company with the drawn lines, a section was mistraced or the original lines are unfair.

The lofted hull feeds everything else: hull data, the lines drawing, offsets CSV, OBJ export, and fitting to evidence. **Example battens** fills in battens taken from the current preset, to try the workflow without a scan. Tracing is saved with the design.

Current limits: the ends are a stem and a sternpost on the centreline (no transom yet), and a traced hull cannot yet be turned back into an editable cage.

## Evidence & reconstruction

Import what survives of a wreck and fit the hull to it.
- **Points:** CSV/TXT/XYZ, one `x, y, z` (metres) per line. Dense clouds are thinned to about 20,000 points.
- **Mesh:** a Wavefront OBJ, for example photogrammetry of surviving timbers.
- **Loose vertices:** vertices not used by any face (left in an OBJ when faces are deleted in MeshLab without *Remove Unreferenced Vertices*) are ignored, and the count is reported.
- **Positioning:** imports are placed on the hull automatically and pivot on their own centre, so site-grid coordinates are no problem.
  - A 3D gizmo **moves**, **rotates** (all three axes) and **scales** (uniformly) the evidence. The Profile, Plan and End views make each move exact.
  - Typed values: up axis (Z or Y), scale, heel, trim, turn and move x/y/z.
  - Buttons: **Centre on hull**, **Sit on baseline** and **Level**. One-sided records are placed with their inner edge on the centreline.
- **Fit:** each point, and each vertex of an imported mesh, is coloured by its distance from the hull surface (green within tolerance, amber within 3×, red beyond), with RMS, maximum and % within tolerance. Port-side records count by symmetry. **Fit report CSV** lists every point's distance.
- **Recorded vs reconstructed:** hull within the *evidence reach* of a recorded point counts as recorded. The **Evidence** surface shades the hull gold (recorded) or blue (reconstructed). In the lines drawing, recorded runs are solid and reconstructed runs dashed, recorded points near each section are plotted as crosses in the body plan, and a key plus the student's **reconstruction notes (paradata)** go on the sheet.
- **Sample wreck:** a coastal trader whose lower hull survives amidships, as points on both sides and three strakes as a mesh.

## Play mode

The opening screen offers two choices. **Test your skills** starts the challenge, and **Explore ship lines** goes straight to the tool. The ▶ PLAY button and the gold side-panel card also start the challenge.

Old Mouldy Lofterson, who lives and works in the Mount Lofty Mould Loft on Kaurna Country, introduces each round. A mould loft is a large, open floor or building where shipbuilders and aircraft makers draw design lines at full size to make moulds, patterns and templates for structural parts. Lofterson designed his famous ship *The Pie Floater* there, a stable vessel although it was not very streamlined. His portrait is by John McCarthy. The challenge has four rounds and 100 points:

1. **Know your lines (20).** A line flashes on the hull. Say whether it is a station, waterline, buttock or diagonal, and which plan shows its true shape. A reference lines drawing of the same hull is beside the questions; after each answer the line is shown in red in all three plans.
2. **Steffy’s labels (15).** A section flashes in profile. Give its Steffy label: A, B, C forward or 1, 2, 3 aft of midships.
3. **Match the section (30).** In a faded end (body) view locked for the round, drag four handles of the midship control section until the hull’s midship section lies on the owner’s dashed target. Live match %, C<sub>m</sub> and C<sub>b</sub> are shown.
4. **Fair the hull (35).** Two handles have been knocked clearly out of line. Students put them back using zebra shading and a live fairness meter. Each handle scores by how close it returns to its fair position, with full marks within about a third of the original error. Zebra shading is always available in Explore mode too.

Grades follow the Flinders scale: High Distinction 85+, Distinction 75+, Credit 65+, Pass 50+. The defaults are *John McCarthy* and *The Pie Floater*; students change them on the start screen. **View certificate** opens the standard 18th-century warship lines, under the student's vessel name, with a *Certificate of Proficiency* cartouche and seal. The title block and certificate scale to the sheet, so A4 to A1 all work.

**Handles:** drag a handle directly. It moves in the plane of the current view, so the profile, plan and end views give clean 2-D moves. Clicking a handle gives the arrow gizmo, and the arrow keys nudge the selection (Shift = fine).

## Phones

Phones and small touch tablets are sent to `mobile.html`, a short read-only tour. It covers the three plans; stations, waterlines, buttocks and diagonals, each highlighted on a real lines drawing; Steffy's conventions; fairing; and the hull presets, with a slowly turning 3D hull. It ends by asking the reader to open Shiplines on a computer, with copy and email buttons for the link. **Open the full version anyway** (`index.html?full=1`) skips the redirect for that browser session; touch devices then get a small "best on a computer" notice.

## How the geometry works

- **Cage.** An 11 × 7 grid of control points runs stern→bow and keel→sheer, for the starboard half only.
- **Subdivision.** On a regular quad grid, Catmull–Clark is exactly the tensor product of the 1-D cubic B-spline rules (vertex ⅛·¾·⅛, edge ½·½). The open edges use the standard crease rules and the corners stay fixed, matching Blender's "keep corners" boundary behaviour. So keel and stem points on the centreplane stay on it at every level. See `js/subdiv.js`.
- **Lines.** Each line is the exact intersection of the subdivided mesh with a plane. The segments are chained into polylines through shared mesh edges (`js/slicer.js`). In the drawing, the curves are run through those intersection points with a Catmull–Rom "batten".
- **Hydrostatics.** Sectional areas below the LWL are integrated along the length from 48 transverse slices (`js/lines.js`).

The clipper, canoe and simple presets are parametric teaching forms (`js/presets.js`). The cargo ship and 18th-century warship are hand-faired control cages (`js/templates.js`), edited by John McCarthy in Shiplines itself. To update a template, save the design as JSON from the app and replace that preset's points in `js/templates.js`. None of the presets is a reconstruction of a particular vessel.

## Files

```
index.html          app shell
css/style.css       Flinders-branded UI
js/main.js          state, UI wiring, undo, exports
js/presets.js       hull presets (parametric generator) and centreplane constraints
js/templates.js     hand-faired cages for the cargo ship and warship presets
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
